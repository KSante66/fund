'use client';

import { useState } from 'react';
import { Lock, User } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginModal({ onClose, isExplicitLoginRef, initialError = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(initialError);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');
    const account = username.trim();
    if (!account) {
      setLoginError('请输入账号');
      return;
    }
    if (!password) {
      setLoginError('请输入密码');
      return;
    }

    try {
      if (isExplicitLoginRef) isExplicitLoginRef.current = true;
      setLoginLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ username: account, password });
      if (error) throw error;
      if (data?.user) onClose();
    } catch (error) {
      setLoginError(error.message || '登录失败，请稍后再试');
      if (isExplicitLoginRef) isExplicitLoginRef.current = false;
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="登录" onClick={onClose}>
      <div className="glass card modal login-modal" onClick={(event) => event.stopPropagation()}>
        <div className="title" style={{ marginBottom: 16 }}>
          <User width="20" height="20" />
          <span>账号登录</span>
          <span className="muted">使用账号和密码登录</span>
        </div>

        <form onSubmit={handleLogin}>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <div className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>
              账号不存在时会自动创建
            </div>
            <div style={{ position: 'relative' }}>
              <User width="16" height="16" style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
              <input
                style={{ width: '100%', paddingLeft: 36 }}
                className="input"
                type="text"
                placeholder="请输入账号"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loginLoading}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative' }}>
              <Lock width="16" height="16" style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
              <input
                style={{ width: '100%', paddingLeft: 36 }}
                className="input"
                type="password"
                placeholder="请输入密码"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loginLoading}
              />
            </div>
          </div>

          {loginError && (
            <div className="login-message error" style={{ marginBottom: 12 }}>
              <span>{loginError}</span>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="button secondary" onClick={onClose}>
              取消
            </button>
            <button className="button" type="submit" disabled={loginLoading}>
              {loginLoading ? '登录中...' : '登录 / 创建账号'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
