import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MORE_BELOW_TEXT, moreBelow } from '../scroll-cue';
import { Icon } from './Icon';

interface Props {
  className: string;
  children: ReactNode;
  /** The scrolling element, for the screen that moves focus inside it. */
  innerRef?: RefObject<HTMLDivElement | null>;
}

/**
 * The scrolling body of a panel. Its scrollbar is hidden, so while more content lies below, a fade and
 * "mais abaixo ↓" show at the bottom edge (they ignore the pointer and the keyboard: purely a hint).
 */
export function ScrollBody({ className, children, innerRef }: Props) {
  const own = useRef<HTMLDivElement>(null);
  const ref = innerRef ?? own;
  const [more, setMore] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setMore(moreBelow(element));
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    // Content that grows or changes (a list opening, the preview filling in) is not a resize of the box.
    const mutation = new MutationObserver(update);
    mutation.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return () => {
      element.removeEventListener('scroll', update);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);

  return (
    <div className="scroll-wrap" data-more={more}>
      <div className={className} ref={ref}>
        {children}
      </div>
      <div className="scroll-cue" aria-hidden="true">
        <span>
          {MORE_BELOW_TEXT} <Icon name="chevronDown" />
        </span>
      </div>
    </div>
  );
}
