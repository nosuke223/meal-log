// /api/ 以下のすべてのリクエストを、API（server/api.ts）で処理する
import { createApiHandler, type ApiEnv } from '../../server/api'

const handleApiRequest = createApiHandler()

export const onRequest = (context: { request: Request; env: ApiEnv }): Promise<Response> =>
  handleApiRequest(context.request, context.env)
