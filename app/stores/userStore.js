import { create } from 'zustand';

/**
 * 当前登录用户。
 * 会话由服务端 httpOnly cookie 维护；本 store 仅维护内存中的用户快照，供全局订阅。
 */
export const useUserStore = create((set) => ({
  user: null,

  /** @param {{ id: string, username?: string, email?: string } | null} next */
  setUser: (next) => set({ user: next }),

  clearUser: () => set({ user: null })
}));

/** 在非 React 代码（如异步回调）中读取当前用户 */
export const getAuthUser = () => useUserStore.getState().user;

/** 在非 React 代码中写入用户 */
export const setAuthUser = (user) => {
  useUserStore.getState().setUser(user);
};

export const clearAuthUser = () => {
  useUserStore.getState().clearUser();
};
