import { formatTimeOfDay, type Resume, type Weekday } from '@tv-chuvisco/nucleo';
import { useEffect, useState } from 'react';

const WEEKDAY_NAMES: Record<Weekday, string> = {
  dom: 'domingo',
  seg: 'segunda-feira',
  ter: 'terça-feira',
  qua: 'quarta-feira',
  qui: 'quinta-feira',
  sex: 'sexta-feira',
  sab: 'sábado',
};

/** "Voltamos às 08:00", "Voltamos amanhã às 08:00" or "Voltamos segunda-feira às 08:00". */
export function resumeText(resume: Resume): string {
  const time = formatTimeOfDay(resume.seconds);
  if (resume.daysAhead <= 0) return `Voltamos às ${time}`;
  if (resume.daysAhead === 1) return `Voltamos amanhã às ${time}`;
  return `Voltamos ${WEEKDAY_NAMES[resume.weekday]} às ${time}`;
}

// SMPTE-style test card: seven colour bars, the reverse "castellations" and the PLUGE strip.
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const CASTELLATIONS = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];

function clockText(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The "fora do ar" screen of `horario: real`: a period test card with the
 * channel name, when it comes back and a running clock. Drawn with CSS, so it
 * scales with the picture (see .offair in styles.css).
 */
export function OffAir({ channelName, resume }: { channelName: string; resume: Resume }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="offair" role="status">
      <div className="offair-bars">
        {BARS.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
      </div>
      <div className="offair-reverse">
        {CASTELLATIONS.map((color, i) => (
          <i key={i} style={{ background: color }} />
        ))}
      </div>
      <div className="offair-pluge">
        <i style={{ background: '#00214c', flex: 5 }} />
        <i style={{ background: '#fff', flex: 5 }} />
        <i style={{ background: '#32006a', flex: 5 }} />
        <i style={{ background: '#131313', flex: 6 }} />
        <i style={{ background: '#050505', flex: 1.5 }} />
        <i style={{ background: '#131313', flex: 1.5 }} />
        <i style={{ background: '#242424', flex: 1.5 }} />
        <i style={{ background: '#131313', flex: 6 }} />
      </div>
      <div className="offair-card">
        <span className="offair-channel">{channelName}</span>
        <strong className="offair-title">Fora do ar</strong>
        <span className="offair-back">{resumeText(resume)}</span>
        <span className="offair-clock">{clockText(now)}</span>
      </div>
    </div>
  );
}
