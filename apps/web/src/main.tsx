import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'xp.css/dist/XP.css'
import './styles/app.css'

import { App } from './App'
import { prepararApi } from './api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // o disco so muda por acao nossa: nao ha por que refetch ao focar a janela
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    },
  },
})

// semeia o mock antes de montar, para a primeira tela ja ter conteudo
prepararApi().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
