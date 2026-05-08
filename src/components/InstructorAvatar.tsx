import { h } from 'preact'

interface InstructorAvatarProps {
  /** Resolved instructor object from a slot. Null when no instructor assigned. */
  instructor: {
    firstName: string
    lastName: string
    photoUrl?: string | null
  } | null | undefined
  /** Size in pixels. Defaults to 32. */
  size?: number
}

/**
 * Tiny circular avatar for an instructor. When the venue has uploaded a photo
 * (Staff.photoUrl), shows the image; otherwise falls back to a tinted circle
 * with the instructor's first initial. Same component is used in the class
 * list rows + calendar blocks so the visual stays consistent.
 *
 * Returns null when instructor is null/undefined — caller can compose around
 * "no instructor assigned" copy without an awkward placeholder dot.
 */
export function InstructorAvatar({ instructor, size = 32 }: InstructorAvatarProps) {
  if (!instructor) return null
  const initial = (instructor.firstName ?? '?').charAt(0).toUpperCase()
  const dim = `${size}px`
  if (instructor.photoUrl) {
    return (
      <img
        src={instructor.photoUrl}
        alt=""
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          flexShrink: 0,
          objectFit: 'cover',
          background: 'var(--avq-muted, #f8f9fb)',
        }}
        onError={(e) => {
          // Hide the broken <img>; the InitialBubble fallback below would
          // need a re-render, so the simplest UX is to just hide the avatar.
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: dim,
        height: dim,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 14%, var(--avq-bg, #fff))',
        color: 'var(--avq-accent, #6366f1)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${Math.round(size * 0.4)}px`,
        fontWeight: '700',
        letterSpacing: '-0.5px',
      }}
    >
      {initial}
    </span>
  )
}
