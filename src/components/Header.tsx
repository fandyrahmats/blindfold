import type { User } from 'firebase/auth';
import type { DeviceStatus } from '../lib/router';

interface Props {
  configured: boolean;
  appCheckReady: boolean;
  device: DeviceStatus;
  progress: number | null;
  online: boolean;
  user: User | null;
  onHome: () => void;
  onEnableDevice: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onWipe: () => void;
}

function DevicePill({ configured, device, progress, onEnableDevice }: Pick<Props, 'configured' | 'device' | 'progress' | 'onEnableDevice'>) {
  if (device === 'available') {
    return (
      <span className="pill pill-device" title="Gemini Nano is ready in this browser. Detection and light tasks run here.">
        <i className="dot" /> On-device AI ready
      </span>
    );
  }
  if (device === 'downloading' || progress !== null) {
    return (
      <span className="pill pill-device">
        <i className="dot pulse" /> Downloading on-device model{progress !== null ? ` · ${Math.round(progress * 100)}%` : '…'}
      </span>
    );
  }
  if (device === 'downloadable') {
    return configured ? (
      <button className="pill pill-action" onClick={onEnableDevice} title="Downloads Gemini Nano once. After that it runs offline.">
        Enable on-device AI
      </button>
    ) : (
      <span className="pill pill-warn">On-device AI can be enabled once Firebase is connected</span>
    );
  }
  if (device === 'unknown') return <span className="pill">Checking this device…</span>;
  return (
    <span
      className="pill pill-cloud"
      title="This browser has no built-in model (needs desktop Chrome with enough memory and disk). Blindfold falls back to patterns plus the cloud model."
    >
      <i className="dot" /> No on-device model · cloud fallback
    </span>
  );
}

export function Header(props: Props) {
  const { configured, appCheckReady, online, user } = props;
  return (
    <header className="top">
      <button className="brand" onClick={props.onHome} aria-label="Blindfold home">
        <svg viewBox="0 0 34 18" aria-hidden="true">
          <path d="M1 5.5h24l8-4.5v16l-8-4.5H1z" />
        </svg>
        <span>Blindfold</span>
      </button>
      <div className="status">
        {!configured && (
          <span className="pill pill-warn" title="Add your Firebase web config to .env.local to turn on AI. The pattern shield works without it.">
            Firebase not connected · pattern shield only
          </span>
        )}
        {configured && !appCheckReady && (
          <span className="pill pill-warn" title="Set VITE_RECAPTCHA_ENTERPRISE_SITE_KEY or VITE_RECAPTCHA_V3_SITE_KEY so App Check can attest this app.">
            App Check not set up
          </span>
        )}
        <DevicePill {...props} />
        {!online && (
          <span className="pill pill-warn">
            <i className="dot" /> Offline
          </span>
        )}
        {configured &&
          (user && !user.isAnonymous ? (
            <button className="pill pill-action" onClick={props.onSignOut} title="Sign out">
              {user.displayName ?? user.email ?? 'Signed in'} · Sign out
            </button>
          ) : (
            <button className="pill pill-action" onClick={props.onSignIn} title="Sync your blindfolded threads across devices. Real values never sync.">
              Sign in to sync
            </button>
          ))}
        <button className="pill pill-action" onClick={props.onWipe} title="Delete every original document and vault stored in this browser">
          Wipe local vault
        </button>
      </div>
    </header>
  );
}
