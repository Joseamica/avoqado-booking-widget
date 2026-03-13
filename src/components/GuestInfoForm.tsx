import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { z } from 'zod'
import type { PublicVenueInfo, PublicSlot } from '../types'
import type { TFunction } from '../i18n'
import { Input, Textarea } from './ui/Input'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'

export interface GuestFormData {
  guestPhone: string
  guestName: string
  guestEmail?: string
  partySize?: number
  specialRequests?: string
}

export interface LoggedInCustomer {
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}

interface GuestInfoFormProps {
  venueInfo: PublicVenueInfo
  selectedSlot?: PublicSlot | null
  selectedSpotCount?: number
  onSubmit: (data: GuestFormData) => void
  isSubmitting: boolean
  t: TFunction
  loggedInCustomer?: LoggedInCustomer | null
}

function createSchema(requireEmail: boolean) {
  return z.object({
    guestPhone: z.string().min(1),
    guestName: z.string().min(1),
    guestEmail: requireEmail
      ? z.string().min(1).email()
      : z.string().email().optional().or(z.literal('')),
    partySize: z.coerce.number().min(1).max(100).optional(),
    specialRequests: z.string().max(2000).optional(),
  })
}

export function GuestInfoForm({ venueInfo, selectedSlot, selectedSpotCount, onSubmit, isSubmitting, t, loggedInCustomer }: GuestInfoFormProps) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [requests, setRequests] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Pre-fill from logged-in customer
  useEffect(() => {
    if (loggedInCustomer) {
      if (loggedInCustomer.phone && !phone) setPhone(loggedInCustomer.phone)
      if (loggedInCustomer.firstName && !name) {
        const fullName = [loggedInCustomer.firstName, loggedInCustomer.lastName].filter(Boolean).join(' ')
        setName(fullName)
      }
      if (loggedInCustomer.email && !email) setEmail(loggedInCustomer.email)
    }
  }, [loggedInCustomer])

  function handleSubmit(e: Event) {
    e.preventDefault()
    const schema = createSchema(venueInfo.publicBooking.requireEmail)
    const result = schema.safeParse({
      guestPhone: phone,
      guestName: name,
      guestEmail: email || undefined,
      partySize: partySize ? Number(partySize) : undefined,
      specialRequests: requests || undefined,
    })

    if (!result.success) {
      const errs: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string
        if (field === 'guestPhone') errs.guestPhone = t('validation.phoneRequired')
        else if (field === 'guestName') errs.guestName = t('validation.nameRequired')
        else if (field === 'guestEmail') errs.guestEmail = venueInfo.publicBooking.requireEmail ? t('validation.emailRequired') : t('validation.emailInvalid')
      }
      setErrors(errs)
      return
    }

    // Validate party size against CLASS slot remaining capacity
    if (selectedSlot?.remaining != null) {
      const requestedSize = result.data.partySize ?? 1
      if (requestedSize > selectedSlot.remaining) {
        setErrors({ partySize: t(selectedSlot.remaining === 1 ? 'validation.partySizeExceeded_one' : 'validation.partySizeExceeded', { count: selectedSlot.remaining }) })
        return
      }
    }

    setErrors({})
    onSubmit(result.data as GuestFormData)
  }

  const isLoggedIn = !!loggedInCustomer && !!(loggedInCustomer.phone || loggedInCustomer.email)

  return (
    <form onSubmit={handleSubmit}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '20px', color: 'var(--avq-fg, #111827)' }}>
        {t('form.title')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {/* Logged-in customer banner */}
        {isLoggedIn && (
          <div style={{
            padding: '12px 16px', borderRadius: '12px',
            background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 6%, var(--avq-bg, #fff))',
            border: '1px solid color-mix(in srgb, var(--avq-accent, #6366f1) 15%, var(--avq-border, #e8eaed))',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
              background: 'var(--avq-accent, #6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: '700', color: '#ffffff',
            }}>
              {(loggedInCustomer!.firstName ?? loggedInCustomer!.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>
                {t('form.bookingAs', { name: name || loggedInCustomer!.email || '' })}
              </p>
              {loggedInCustomer!.email && (
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {loggedInCustomer!.email}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Phone */}
        {!isLoggedIn || !loggedInCustomer?.phone ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label for="avq-phone" style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
              {t('form.phone')} *
            </label>
            <Input
              id="avq-phone"
              type="tel"
              value={phone}
              placeholder={t('form.phonePlaceholder')}
              onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
              error={errors.guestPhone}
            />
            {errors.guestPhone && <p style={{ margin: 0, fontSize: '12px', color: '#ef4444' }}>{errors.guestPhone}</p>}
          </div>
        ) : null}

        {/* Name */}
        {!isLoggedIn || !loggedInCustomer?.firstName ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label for="avq-name" style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
              {t('form.name')} *
            </label>
            <Input
              id="avq-name"
              value={name}
              placeholder={t('form.namePlaceholder')}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              error={errors.guestName}
            />
            {errors.guestName && <p style={{ margin: 0, fontSize: '12px', color: '#ef4444' }}>{errors.guestName}</p>}
          </div>
        ) : null}

        {/* Email */}
        {!isLoggedIn || !loggedInCustomer?.email ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label for="avq-email" style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
              {venueInfo.publicBooking.requireEmail ? `${t('form.email').replace(' (optional)', '').replace(' (opcional)', '')} *` : t('form.email')}
            </label>
            <Input
              id="avq-email"
              type="email"
              value={email}
              placeholder={t('form.emailPlaceholder')}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              error={errors.guestEmail}
            />
            {errors.guestEmail && <p style={{ margin: 0, fontSize: '12px', color: '#ef4444' }}>{errors.guestEmail}</p>}
          </div>
        ) : null}

        {/* Party size — hidden when spots were pre-selected */}
        {selectedSpotCount && selectedSpotCount > 0 ? (
          <div style={{
            padding: '12px 16px', borderRadius: '10px',
            background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 6%, var(--avq-bg, #fff))',
            border: '1px solid color-mix(in srgb, var(--avq-accent, #6366f1) 15%, var(--avq-border, #e8eaed))',
            fontSize: '13px', color: 'var(--avq-fg, #111827)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
            {t('seats.selectedCount', { count: selectedSpotCount })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label for="avq-party" style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
              {t('form.partySize')}
            </label>
            <Input
              id="avq-party"
              type="number"
              value={partySize}
              min={1}
              max={selectedSlot?.remaining != null ? selectedSlot.remaining : 100}
              onInput={(e) => setPartySize((e.target as HTMLInputElement).value)}
              error={errors.partySize}
            />
            {errors.partySize && <p style={{ margin: 0, fontSize: '12px', color: '#ef4444' }}>{errors.partySize}</p>}
          </div>
        )}

        {/* Special requests */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label for="avq-requests" style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)' }}>
            {t('form.specialRequests')}
          </label>
          <Textarea
            id="avq-requests"
            value={requests}
            placeholder={t('form.specialRequestsPlaceholder')}
            onInput={(e) => setRequests((e.target as HTMLTextAreaElement).value)}
            rows={3}
          />
        </div>

        <Button type="submit" fullWidth disabled={isSubmitting}>
          {isSubmitting ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><Spinner size={16} />{t('form.submitting')}</span>
          ) : t('form.submit')}
        </Button>
      </div>
    </form>
  )
}
