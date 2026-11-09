/**
 * Navigation and the learning actions shared by every screen.
 * App.jsx provides the stack; screens call useNav().
 */
import { createContext, useContext } from 'react'
import { buildLibrary } from './graph.js'
import { send } from './ai.js'
import { buzz } from './native.js'
import { chatForGoal, createChat, getState } from './storage.js'
import { fill, t } from './i18n.js'

export const NavContext = createContext(null)
export const useNav = () => useContext(NavContext)

/** Goals in the learner's map, newest first, minus the ones they removed. */
export function libraryOf(knowledge, now = Date.now()) {
  const hidden = new Set(knowledge.hidden ?? [])
  return buildLibrary(knowledge, now).goals.filter(e => !hidden.has(e.goal.id))
}

/** Vibrate when a tool call lights a node. */
export function onToolEvent(display) {
  if (display?.type === 'record' && display.level >= 1 && display.level > display.before) buzz('success')
  else if (display?.type === 'plan') buzz('medium')
}

/**
 * Build the navigation API around a stack setter.
 * @param {(fn: (stack: object[]) => object[]) => void} setStack
 */
export function makeNav(setStack, setTab, toast) {
  const push = screen => setStack(s => [...s, screen])
  const nav = {
    toast,
    setTab,
    back: () => setStack(s => s.slice(0, -1)),
    openTree: (goals, chatId) => push({ type: 'tree', goals, chatId, key: Date.now() }),
    openChat: chatId => push({ type: 'chat', chatId, key: Date.now() }),
    openSettings: () => { setStack([]); setTab('settings') },

    /** "我想学会 X": a new conversation that plans the tree. */
    startGoal(goal) {
      const chat = createChat({ title: goal })
      nav.openChat(chat.id)
      send(chat.id, fill(t('goal.prompt'), { goal }), onToolEvent, fill(t('label.goal'), { goal }))
    },

    /** A new, empty conversation. */
    newChat() {
      const chat = createChat()
      nav.openChat(chat.id)
    },

    /**
     * Send a tree action (learn, test me, review…) to the right conversation:
     * the one the tree was opened from, else the latest one for this goal,
     * else a new one that first opens the goal's tree (and then sends `newText` when given).
     */
    learn({ goals, chatId, text, newText, label }) {
      if (chatId && getState().chats[chatId]) {
        // Opened from a chat: go back to it.
        setStack(s => {
          const i = s.findLastIndex(x => x.type === 'chat' && x.chatId === chatId)
          return i >= 0 ? s.slice(0, i + 1) : [...s, { type: 'chat', chatId, key: Date.now() }]
        })
        send(chatId, text, onToolEvent, label)
        return
      }
      const goal = goals[0]
      let chat = chatForGoal(goal.id)
      let message = text
      if (!chat) {
        chat = createChat({ goals, title: goal.name })
        message = `${fill(t('prompt.resume'), { goal: goal.name, goalId: goal.id })}${newText ?? text}`
      }
      nav.openChat(chat.id)
      send(chat.id, message, onToolEvent, label)
    },
  }
  return nav
}
