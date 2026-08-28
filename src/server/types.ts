/**
 * Hono Variables type used across all routes. Open-source single-user shape:
 * no `userId` since there's no User entity. The interface is exported so
 * future routes can extend it (e.g. request id for tracing).
 */
export interface AppVariables {}

export interface AppEnv {
  Variables: AppVariables;
}
