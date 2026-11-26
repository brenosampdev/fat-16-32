// Ponto unico de entrada da API.
//
// Enquanto o back nao estiver pronto, rode com VITE_MOCK=1 (ja vem no .env.development).
// Quando estiver, apague a variavel e nada mais muda no resto do codigo.

import { httpApi } from './client'
import { mockApi, semear } from './mock'
import type { FatApi } from './types'

const USANDO_MOCK = import.meta.env?.VITE_MOCK === '1'

export const api: FatApi = USANDO_MOCK ? mockApi : httpApi

/** Chame uma vez no bootstrap. Com o back real, nao faz nada. */
export async function prepararApi(): Promise<void> {
  if (USANDO_MOCK) await semear()
}

export { USANDO_MOCK }
export { ApiError, NetworkError, ehSemDisco, extrairErro } from './client'
export * from './normalize'
export * from './paths'
export * from './types'
