import type { Session } from '../../shared/types'

// New installations start empty. Existing user sessions are not modified.
export const defaultSessionsForEN: Session[] = []
export const defaultSessionsForCN: Session[] = []

// Preserve historical template exports for migrations and older callers,
// without provider settings, remote assets, or seeded demo messages.
function emptySession(id: string, name: string, type: Session['type']): Session {
  return { id, name, type, messages: [] }
}

export const imageCreatorSessionForCN: Session = emptySession(
  'chatbox-chat-demo-image-creator',
  'Image Creator (Example)',
  'picture'
)
export const imageCreatorSessionForEN: Session = emptySession(
  'chatbox-chat-demo-image-creator',
  'Image Creator (Example)',
  'picture'
)
export const artifactSessionCN: Session = emptySession('chatbox-chat-demo-artifact-1-cn', '贪吃蛇(Artifact Example)', 'chat')
export const artifactSessionEN: Session = emptySession('chatbox-chat-demo-artifact-1-en', 'Snake Game (Artifact Example)', 'chat')
export const mermaidSessionEN: Session = emptySession('mermaid-demo-1-en', 'ChartWhiz', 'chat')
export const mermaidSessionCN: Session = emptySession('mermaid-demo-1-cn', '做图表', 'chat')
