'use client';

const listeners = new Set();

const notifyAuth = (event, session) => {
  listeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch (error) {
      console.error('auth listener failed', error);
    }
  });
};

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { data: null, error: { message: data.error || data?.error?.message || response.statusText } };
  }
  return { data, error: data.error || null };
}

function createSelectBuilder(table, columns) {
  const state = {
    table,
    action: 'select',
    columns,
    filters: [],
    inFilters: [],
    maybeSingle: false
  };

  const run = async () => {
    const { data, error } = await apiFetch('/api/data/query', {
      method: 'POST',
      body: JSON.stringify(state)
    });
    if (error) return { data: null, error };
    return { data: data.data, error: data.error || null };
  };

  const builder = {
    eq(column, value) {
      state.filters.push({ column, value });
      return builder;
    },
    in(column, values) {
      state.inFilters.push({ column, values });
      return builder;
    },
    maybeSingle() {
      state.maybeSingle = true;
      return run();
    },
    then(resolve, reject) {
      return run().then(resolve, reject);
    },
    catch(reject) {
      return run().catch(reject);
    },
    finally(callback) {
      return run().finally(callback);
    }
  };
  return builder;
}

function createTable(table) {
  return {
    select(columns = '*') {
      return createSelectBuilder(table, columns);
    },
    async insert(values) {
      const { data, error } = await apiFetch('/api/data/query', {
        method: 'POST',
        body: JSON.stringify({ table, action: 'insert', values })
      });
      return { data: data?.data ?? null, error };
    },
    upsert(values) {
      return {
        async select() {
          const { data, error } = await apiFetch('/api/data/query', {
            method: 'POST',
            body: JSON.stringify({ table, action: 'upsert', values })
          });
          return { data: data?.data ?? null, error };
        }
      };
    }
  };
}

const createNoopChannel = () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel
  };
  return channel;
};

export const isSupabaseConfigured = true;

export const supabase = {
  auth: {
    async getSession() {
      const { data, error } = await apiFetch('/api/auth/session');
      return { data: { session: data?.session || null }, error };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => listeners.delete(callback)
          }
        }
      };
    },
    async signInWithPassword({ username, password }) {
      const { data, error } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      const session = data?.session || null;
      if (!error && session) notifyAuth('SIGNED_IN', session);
      return { data: { session, user: session?.user || null }, error };
    },
    async signOut() {
      const { error } = await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
      notifyAuth('SIGNED_OUT', null);
      return { error };
    },
    signInWithOtp: async () => ({ data: null, error: { message: '请使用账号密码登录' } }),
    signInWithOAuth: async () => ({ data: null, error: { message: '第三方登录已关闭' } }),
    verifyOtp: async () => ({ data: null, error: { message: '验证码登录已关闭' } })
  },
  from: (table) => createTable(table),
  async rpc(fn, args) {
    const { data, error } = await apiFetch('/api/data/rpc', {
      method: 'POST',
      body: JSON.stringify({ fn, args })
    });
    return { data: data?.data ?? null, error: data?.error || error };
  },
  channel: () => createNoopChannel(),
  removeChannel: () => {},
  functions: {
    invoke: async () => ({ data: null, error: { message: '云函数未配置' } })
  }
};
