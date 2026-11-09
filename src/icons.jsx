/** Line icons for the app chrome (the tree canvas has its own in tree.js). */
const Svg = ({ size = 22, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
)

export const BackIcon = p => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>
export const ChatIcon = p => <Svg {...p}><path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z" /><path d="M9 9.5h6M9 12.5h4" /></Svg>
export const GearIcon = p => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>
export const TrashIcon = p => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Svg>
export const SendIcon = p => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>
export const StopIcon = p => <Svg {...p}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></Svg>
export const PlusIcon = p => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const ChevronIcon = p => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>
export const KeyIcon = p => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></Svg>
export const AlertIcon = p => <Svg {...p}><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></Svg>
