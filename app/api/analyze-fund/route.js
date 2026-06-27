import { NextResponse } from 'next/server';
import { query } from '@/app/lib/server/db';
import { requireUser } from '@/app/lib/server/auth';

// LLM 代理配置（服务端私有：不带 NEXT_PUBLIC_ 前缀，密钥不会注入浏览器产物）
const LLM_API_URL = process.env.LLM_API_URL || 'https://ksante66-zxqq.hf.space';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-5.5';
// 每日 OCR 识别上限（与 fetchOcrDailyRemaining 默认值保持一致）
const MAX_DAILY_OCR = Number(process.env.OCR_DAILY_LIMIT) || 5;

const FUND_OCR_SYSTEM_PROMPT = `你是一个专业的基金持仓OCR解析助手。

任务目标：
从提供的OCR识别文本中提取所有基金信息，并尽可能补全基金代码。

字段定义：

1. fundName（必填）
   - 基金名称。
   - 保留完整名称，包括括号、英文、A/C类后缀等。
   - 不允许截断或简写。

2. fundCode（必填）
   - 优先从OCR文本中提取6位基金代码。
   - 如果OCR文本中未出现基金代码，则根据fundName查询对应的基金代码并补全。
   - 若存在多个可能匹配结果，选择与基金名称最完全一致的基金。
   - 若仍无法确定，则返回空字符串 ""。

3. holdAmounts（可选）
   - 持有金额。
   - 保留原始数字格式。
   - 不存在时返回空字符串 ""。

4. holdGains（可选）
   - 持有收益。
   - 保留正负号及小数。
   - 不存在时返回空字符串 ""。

解析规则：

- 识别所有基金，不遗漏任何基金记录。
- 基金名称附近出现的金额、收益优先归属于该基金。
- 忽略账户信息、广告、提示语、时间、页脚页眉等无关内容。
- 同一基金只输出一次。
- 基金代码必须为6位数字字符串。
- 当fundCode缺失时，必须优先尝试根据fundName检索并补全fundCode，而不是直接返回空字符串。
- 若检索结果存在歧义且无法确定唯一基金代码，则返回空字符串。

输出要求：

仅返回JSON数组，不要输出任何解释、备注、Markdown代码块或其他文本。

输出格式示例：

[
  {
    "fundName": "易方达蓝筹精选混合",
    "fundCode": "005827",
    "holdAmounts": "12345.67",
    "holdGains": "345.21"
  },
  {
    "fundName": "华夏成长混合",
    "fundCode": "000001",
    "holdAmounts": "",
    "holdGains": ""
  }
]`;

// 清洗模型输出：移除 <think> 思考过程、markdown 代码块标记与特殊空白字符
function cleanModelOutput(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/[\u00A0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ')
    .trim();
}

// 从模型文本中提取 JSON（优先匹配数组结构，其次对象结构）
function extractFundJSON(cleanedText) {
  if (!cleanedText) return null;
  let match = cleanedText.match(/\[[\s\S]*\]/);
  if (!match) match = cleanedText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('analyze-fund JSON 解析失败:', err);
    return null;
  }
}

// 原子检查并自增今日 OCR 用量：未超限则 count+1 并返回 allowed=true
async function checkAndIncrementOcrUsage(userId) {
  const updated = await query(
    `INSERT INTO ocr_daily_usage (user_id, usage_date, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET count = ocr_daily_usage.count + 1
     WHERE ocr_daily_usage.count < $2
     RETURNING count`,
    [userId, MAX_DAILY_OCR]
  );
  if (updated.rows.length > 0) {
    return { allowed: true, count: updated.rows[0].count };
  }
  // 未命中更新 = 已达上限，单独查询当前计数用于提示
  const current = await query(
    `SELECT count FROM ocr_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
    [userId]
  );
  return { allowed: false, count: current.rows[0]?.count ?? MAX_DAILY_OCR };
}

export async function POST(request) {
  try {
    // 1. 校验登录（同时保护 LLM 密钥/配额不被匿名滥用）
    const user = await requireUser();

    // 2. 取出并清洗输入文本
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text || '')
      .replace(/\s+/g, ' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
    if (!text) {
      return NextResponse.json({ success: false, error: '未提供有效文本' }, { status: 400 });
    }
    if (!LLM_API_KEY) {
      console.error('analyze-fund: 未配置 LLM_API_KEY');
      return NextResponse.json({ success: false, error: 'LLM 服务未配置' }, { status: 503 });
    }

    // 3. 每日用量限流（原子自增，超限直接返回 429）
    const usage = await checkAndIncrementOcrUsage(user.id);
    if (!usage.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'DAILY_LIMIT_EXCEEDED',
          message: `每日识别次数已达上限（${MAX_DAILY_OCR} 次），请明天再试`,
          remaining: 0,
          max: MAX_DAILY_OCR
        },
        { status: 429 }
      );
    }

    // 4. 转发到 OpenAI 兼容的 LLM 代理（密钥仅存在于服务端）
    const resp = await fetch(`${LLM_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        stream: false,
        messages: [
          { role: 'system', content: FUND_OCR_SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM 接口请求失败 (${resp.status}): ${errText}`);
    }

    // 5. 解析并清洗模型返回
    const result = await resp.json();
    const rawContent = result?.choices?.[0]?.message?.content || '';
    const parsed = extractFundJSON(cleanModelOutput(rawContent));
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: '模型未返回合法 JSON', raw: rawContent },
        { status: 502 }
      );
    }

    // 6. 字段类型安全化
    const data = parsed.map((item) => ({
      fundName: String(item?.fundName || ''),
      fundCode: String(item?.fundCode || ''),
      holdAmounts: String(item?.holdAmounts || ''),
      holdGains: String(item?.holdGains || '')
    }));

    return NextResponse.json({
      success: true,
      data,
      remaining: Math.max(0, MAX_DAILY_OCR - usage.count),
      max: MAX_DAILY_OCR
    });
  } catch (error) {
    console.error('analyze-fund failed', error);
    return NextResponse.json(
      { success: false, error: error.message || '解析失败' },
      { status: error.status || 500 }
    );
  }
}
