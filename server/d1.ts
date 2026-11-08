// D1（Cloudflare の SQLite）の型のうち、この API で使うものだけ。
// 本物の型（@cloudflare/workers-types）の一部と同じ形にしている

export type D1Result<T = Record<string, unknown>> = {
  results: T[]
  success: boolean
  meta: {
    /** 書き換えた行の数 */
    changes: number
  }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  /** 渡した文を1つのトランザクションで順に実行する（1つでも失敗したら、すべて取り消す） */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}
