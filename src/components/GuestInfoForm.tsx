import { h } from 'preact'
import { useState } from 'preact/hooks'
import { z } from 'zod'
import type { PublicVenueInfo } from '../types'
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

interface GuestInfoFormProps {
  venueInfo: PublicVenueInfo
  onSubmit: (data: GuestFormData) => void
  isSubmitting: boolean
  t: TFunction
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

export function GuestInfoForm({ venueInfo, onSubmit, isSubmitting, t }: GuestInfoFormProps) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [requests, setRequests] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

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

    setErrors({})
    onSubmit(result.data as GuestFormData)
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-5">
      <h2 class="text-lg font-semibold text-[var(--avq-fg,#111827)]">{t('form.title')}</h2>

      {/* Phone */}
      <div class="space-y-1.5">
        <label for="avq-phone" class="block text-sm font-medium text-[var(--avq-fg,#111827)]">
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
        {errors.guestPhone && <p class="text-sm text-red-600">{errors.guestPhone}</p>}
      </div>

      {/* Name */}
      <div class="space-y-1.5">
        <label for="avq-name" class="block text-sm font-medium text-[var(--avq-fg,#111827)]">
          {t('form.name')} *
        </label>
        <Input
          id="avq-name"
          value={name}
          placeholder={t('form.namePlaceholder')}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          error={errors.guestName}
        />
        {errors.guestName && <p class="text-sm text-red-600">{errors.guestName}</p>}
      </div>

      {/* Email */}
      <div class="space-y-1.5">
        <label for="avq-email" class="block text-sm font-medium text-[var(--avq-fg,#111827)]">
          {venueInfo.publicBooking.requireEmail ? `${t('form.email').replace(' (optional)', '')} *` : t('form.email')}
        </label>
        <Input
          id="avq-email"
          type="email"
          value={email}
          placeholder={t('form.emailPlaceholder')}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          error={errors.guestEmail}
        />
        {errors.guestEmail && <p class="text-sm text-red-600">{errors.guestEmail}</p>}
      </div>

      {/* Party size */}
      <div class="space-y-1.5">
        <label for="avq-party" class="block text-sm font-medium text-[var(--avq-fg,#111827)]">
          {t('form.partySize')}
        </label>
        <Input
          id="avq-party"
          type="number"
          value={partySize}
          min={1}
          max={100}
          onInput={(e) => setPartySize((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Special requests */}
      <div class="space-y-1.5">
        <label for="avq-requests" class="block text-sm font-medium text-[var(--avq-fg,#111827)]">
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
          <span class="flex items-center gap-2"><Spinner size={16} />{t('form.submitting')}</span>
        ) : t('form.submit')}
      </Button>
    </form>
  )
}
