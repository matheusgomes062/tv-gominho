import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  DAY_SLOTS,
  ROW_TEXT,
  WINDOW_SLOTS,
  blockDetails,
  blockSpeech,
  buildGuide,
  dayFraction,
  focusedBlock,
  initialFocus,
  moveFocus,
  refocus,
  scrollWindow,
  showHues,
  showKey,
  timeTicks,
  windowFor,
  windowSlotsFor,
  type GuideBlock,
  type GuideFocus,
  type GuideRow,
  type Move,
} from '../guide-model';
import type { Airing, WeekModel } from '../week-model';

interface Props {
  week: WeekModel;
  /** Names the guide for screen readers: "A semana", "Semana de 19/10 a 25/10". */
  label: string;
  /** OK on an airing that can be picked (the week of "Mudar uma programação"): the screen opens its list of episodes. */
  onPick?(airing: Airing): void;
}

const TICKS = timeTicks();
const KEY_MOVES: Record<string, Move> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const percent = (seconds: number) => `${dayFraction(seconds) * 100}%`;

/** The element that scrolls the page the guide is in (the body of the panel). */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

/** Seconds since midnight now, kept up to date while the guide is on screen (the "now" line). */
function useNow(): number {
  const read = () => {
    const date = new Date();
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The week as a TV guide (the button GUIA of the cable boxes): time across in half hour slots, a row per day, each
 * episode a block as wide as it plays, a line for "now" on today's row and, on top, a strip that says what the block
 * in focus is. One stop for the keys: Left and Right move from block to block (the window of time follows), Up and
 * Down to the block at the same time on the next day, OK picks (when `onPick` is given and the airing can be picked).
 * The rows, blocks and moves come from guide-model.ts; the week from week-model.ts.
 */
export function Guide({ week, label, onPick }: Props) {
  const guide = useMemo(() => buildGuide(week), [week]);
  const now = useNow();
  const ids = useId();
  const grid = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const hues = useMemo(() => showHues(guide), [guide]);
  const key = useMemo(() => showKey(guide), [guide]);
  const [focus, setFocus] = useState<GuideFocus | null>(() => initialFocus(guide, now));
  // How many half hours fit across: the window is as wide as the screen allows (see windowSlotsFor).
  const [slots, setSlots] = useState(WINDOW_SLOTS);
  const [start, setStart] = useState(() => windowFor(focusedBlock(guide, focus)));

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const lane = element.querySelector('.guide-lane');
      const unit = parseFloat(getComputedStyle(element).fontSize);
      if (lane && unit > 0) setSlots(windowSlotsFor(lane.getBoundingClientRect().width / unit));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  // The window changed its length: keep the block in focus in it.
  useEffect(() => {
    setStart((current) => {
      const target = focusedBlock(guide, focus);
      return target ? scrollWindow(current, target, slots) : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // The week was built again (the real durations came in, a pick changed what airs): keep the place.
  const known = useRef(guide);
  useEffect(() => {
    if (known.current === guide) return;
    known.current = guide;
    setFocus((current) => (current ? refocus(guide, current) : initialFocus(guide, now)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide]);

  const block = focusedBlock(guide, focus);
  const idOf = (b: GuideBlock) => `${ids}-${b.row}-${b.index}`;

  const go = (next: GuideFocus) => {
    const target = focusedBlock(guide, next);
    setFocus(next);
    if (target) {
      setStart((current) => scrollWindow(current, target, slots));
      reveal(grid.current?.querySelector<HTMLElement>(`[data-guide-row="${next.row}"]`));
    }
  };

  /** Scrolls the panel just enough to see `row`, below the strip that stays on top. */
  const reveal = (row: HTMLElement | null | undefined) => {
    const box = row && scrollerOf(row);
    if (!row || !box) return;
    const edge = box.getBoundingClientRect();
    const above = edge.top + (top.current?.offsetHeight ?? 0);
    const place = row.getBoundingClientRect();
    if (place.top < above) box.scrollTop -= above - place.top;
    else if (place.bottom > edge.bottom) box.scrollTop += place.bottom - edge.bottom;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = KEY_MOVES[event.key];
    if (move && focus) {
      const next = moveFocus(guide, focus, move);
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        go(next);
      } else if (move === 'left' || move === 'right') {
        // The ends of a day stay put; Up and Down leave the guide for what is above or below it.
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && block?.airing.editable && onPick) {
      event.preventDefault();
      onPick(block.airing);
    }
  };

  const open = (b: GuideBlock) => {
    go({ row: b.row, index: b.index, time: b.start });
    grid.current?.focus({ preventScroll: true });
    if (b.airing.editable && onPick) onPick(b.airing);
  };

  return (
    <div className="guide" data-guide ref={root} style={{ '--guide-x': `${-dayFraction(start) * 100}%`, '--guide-span': `${(DAY_SLOTS / slots) * 100}%` } as CSSProperties}>
      {/* The strip and the time axis stay on top while the days scroll under them. */}
      <div className="guide-top" ref={top}>
        <Details block={block} row={focus ? guide.rows[focus.row] : undefined} canPick={onPick !== undefined} />
        <div className="guide-head" aria-hidden="true">
          <span className="guide-corner">Dia</span>
          <div className="guide-lane">
            <div className="guide-track">
              {TICKS.map(({ seconds, label: text, kind }) => (
                <span key={seconds} className="guide-slot" data-tick={kind} style={{ left: percent(seconds) }}>
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div
        ref={grid}
        className="guide-grid"
        role="grid"
        aria-label={label}
        aria-activedescendant={block ? idOf(block) : undefined}
        tabIndex={0}
        data-nav
        data-nav-adjust
        onKeyDown={onKeyDown}
        // Coming into the guide shows all of it: its top (the strip) at the top of the screen.
        onFocus={() => {
          const box = root.current && scrollerOf(root.current);
          if (box && root.current) box.scrollTop += root.current.getBoundingClientRect().top - box.getBoundingClientRect().top;
        }}
      >
        {guide.rows.map((row, r) => (
          <div key={row.date} className="guide-row" role="row" data-guide-row={r} data-today={row.today || undefined} data-state={row.state}>
            <span className="guide-day" role="rowheader">
              {row.label}
              {row.today && <em className="guide-today">hoje</em>}
            </span>
            <div className="guide-lane">
              {row.state === 'airs' ? (
                <div className="guide-track">
                  {row.breaks.map((gap) => (
                    <span key={gap.start} className="guide-break" aria-hidden="true" style={{ left: percent(gap.start), width: percent(gap.end - gap.start) }} />
                  ))}
                  {row.blocks.map((b) => (
                    <div
                      key={b.airing.key}
                      id={idOf(b)}
                      role="gridcell"
                      className="guide-block"
                      data-focus={focus?.row === b.row && focus.index === b.index ? '' : undefined}
                      data-pinned={b.airing.pinned ? '' : undefined}
                      data-blocked={b.airing.blocked ? '' : undefined}
                      data-cut={b.start < start ? '' : undefined}
                      aria-label={blockSpeech(b, row.today)}
                      style={{ left: percent(b.start), width: percent(b.end - b.start), '--hue': hues[b.airing.showId] } as CSSProperties}
                      onClick={() => open(b)}
                    >
                      <span className="guide-block-title">{b.airing.showTitle}</span>
                      <span className="guide-block-ep">
                        {b.airing.label}
                        {b.airing.pinned && <b className="guide-mark">Fixo</b>}
                      </span>
                    </div>
                  ))}
                  {row.today && <span className="guide-now" aria-hidden="true" style={{ left: percent(now) }} />}
                </div>
              ) : (
                <p className="guide-empty" role="gridcell">
                  {ROW_TEXT[row.state]}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {key.length > 0 && (
        <ul className="guide-key" aria-label="Cor de cada desenho">
          {key.map((entry) => (
            <li key={entry.showId} style={{ '--hue': entry.hue } as CSSProperties}>
              <i aria-hidden="true" />
              {entry.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Details({ block, row, canPick }: { block: GuideBlock | null; row?: GuideRow; canPick: boolean }) {
  if (!block) {
    return (
      <div className="guide-details" data-empty>
        <strong className="guide-details-show">Nada no ar nesta semana</strong>
      </div>
    );
  }
  const d = blockDetails(block);
  return (
    <div className="guide-details" aria-live="polite" data-details>
      <div className="guide-details-line">
        <span className="guide-details-top">
          <strong className="guide-details-show">{d.show}</strong>
          {d.pinned && (
            <span className="agenda-tag" data-tag="pinned">
              Fixo
            </span>
          )}
          {d.blocked && (
            <span className="agenda-tag" data-tag="blocked">
              não passa
            </span>
          )}
        </span>
        <span className="guide-details-when">
          {row?.label} · {d.span} · {d.length}
        </span>
      </div>
      <div className="guide-details-line">
        <span className="guide-details-ep">{d.episode}</span>
        {canPick && <span className="guide-details-hint">{d.editable ? 'OK: escolher o episódio' : 'Este dia já passou'}</span>}
      </div>
    </div>
  );
}
