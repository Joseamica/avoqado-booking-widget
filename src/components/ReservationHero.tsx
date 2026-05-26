import { h } from 'preact'

interface ReservationHeroProps {
  imageUrl: string
  alt?: string
}

/** Wide cover photo shown above the reservation flow when the venue has a
 *  heroImageUrl AND branding.showHeroImage is true. */
export function ReservationHero({ imageUrl, alt }: ReservationHeroProps) {
  return (
    <div
      class="avq-hero"
      style={{
        width: '100%',
        aspectRatio: '16 / 5',
        borderRadius: '14px',
        overflow: 'hidden',
        marginBottom: '20px',
        background: 'var(--avq-muted, #f8f9fb)',
      }}
    >
      <img
        src={imageUrl}
        alt={alt ?? ''}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  )
}
