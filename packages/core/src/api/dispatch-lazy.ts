import type * as Impl from './dispatch.js';

const impl = () => import('./dispatch.js');

export const apiDispatch: typeof Impl.apiDispatch = async (...args) => (await impl()).apiDispatch(...args);
export const apiDispatchTools: typeof Impl.apiDispatchTools = async (...args) => (await impl()).apiDispatchTools(...args);
export const apiDispatchToolsHistory: typeof Impl.apiDispatchToolsHistory = async (...args) => (await impl()).apiDispatchToolsHistory(...args);
export const apiStreamDispatch: typeof Impl.apiStreamDispatch = async function* (...args) {
  return yield* (await impl()).apiStreamDispatch(...args);
};
export const apiStreamDispatchWithHistory: typeof Impl.apiStreamDispatchWithHistory = async function* (...args) {
  return yield* (await impl()).apiStreamDispatchWithHistory(...args);
};
