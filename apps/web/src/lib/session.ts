// The simulated computer's session: boot, the Bem-vindo screen, the desktop
// and the ways out of it (spec, "Sessão"). Pure: no React, no DOM, so the
// smoke test imports it.

export type Phase = 'boot' | 'welcome' | 'desktop' | 'standby' | 'shutting' | 'off'

/** sessionStorage: this tab has already logged on, so a reload skips boot and Bem-vindo */
export const SIGNED_IN_KEY = 'fatxp.signedIn'

/** how long the boot screen runs before Bem-vindo */
export const BOOT_MS = 3000
/** how long "Bem-vindo" stays after the user tile is clicked */
export const WELCOME_MS = 1000
/** how long "Desligando…" stays before the screen goes off */
export const SHUTTING_MS = 1500

/** Where the page starts: straight on the desktop for a tab already logged on, or with ?sem-boot. */
export function startPhase(search: string, signedIn: boolean): Phase {
  return signedIn || new URLSearchParams(search).has('sem-boot') ? 'desktop' : 'boot'
}
