'use client';

/*
 * First-run introduction.
 *
 * Most people who need this app are not going to read a manual, and the thing
 * they most need to know is the part no other app does: starting it changes a
 * system setting, and stopping it puts that setting back. Four short steps,
 * shown once, skippable at any point.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { PowerIcon, GlobeIcon, SearchIcon, ShieldCheckIcon, CloseIcon } from './icons';

const SEEN_KEY = 'shroudly_onboarded';

const STEPS = [
  { icon: ShieldCheckIcon, title: 'obTitle1', body: 'obBody1' },
  { icon: PowerIcon,       title: 'obTitle2', body: 'obBody2' },
  { icon: GlobeIcon,       title: 'obTitle3', body: 'obBody3' },
  { icon: SearchIcon,      title: 'obTitle4', body: 'obBody4' },
];

export default function Onboarding() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    try { if (!localStorage.getItem(SEEN_KEY)) setOpen(true); } catch {}
  }, []);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  return (
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('obTitle1')}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius)] border p-5"
        style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)', boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-soft)' }}
          >
            <Icon className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('obSkip')}
            className="shrink-0 rounded-md p-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--text-faint)' }}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-3 text-[17px] font-semibold leading-snug wrap-anywhere" style={{ color: 'var(--text)' }}>
          {t(step.title)}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed wrap-anywhere" style={{ color: 'var(--text-dim)' }}>
          {t(step.body)}
        </p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((_, n) => (
              <span
                key={n}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: n === i ? 16 : 6,
                  background: n === i ? 'var(--accent)' : 'var(--line-strong)',
                }}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {i > 0 && (
              <button
                type="button"
                onClick={() => setI(i - 1)}
                className="btn rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-medium"
                style={{ color: 'var(--text-dim)' }}
              >
                {t('obBack')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setI(i + 1))}
              className="btn btn-primary rounded-[var(--radius-sm)] px-4 py-2 text-[13px] font-semibold"
            >
              {last ? t('obDone') : t('obNext')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
