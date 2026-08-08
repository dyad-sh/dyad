import { initBotId } from 'botid/client/core'

initBotId({
  protect: [
    {
      path: '/api/chat',
      method: 'POST',
    },
    {
      path: '/api/errors',
      method: 'POST',
    },
  ],
})
