import React from "react";

type StickyTableState = {
  columnWidths: number[];
  headerHeight: number;
  left: number;
  scrollLeft: number;
  tableWidth: number;
  visible: boolean;
  width: number;
};

const EMPTY_STATE: StickyTableState = {
  columnWidths: [],
  headerHeight: 0,
  left: 0,
  scrollLeft: 0,
  tableWidth: 0,
  visible: false,
  width: 0,
};

function sameState(left: StickyTableState, right: StickyTableState) {
  return (
    left.visible === right.visible &&
    left.left === right.left &&
    left.width === right.width &&
    left.tableWidth === right.tableWidth &&
    left.scrollLeft === right.scrollLeft &&
    left.headerHeight === right.headerHeight &&
    left.columnWidths.length === right.columnWidths.length &&
    left.columnWidths.every((width, index) => width === right.columnWidths[index])
  );
}

export function StickyTable({
  children,
  className,
  renderHeader,
}: {
  children: React.ReactNode;
  className?: string;
  renderHeader: () => React.ReactNode;
}) {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const tableRef = React.useRef<HTMLTableElement | null>(null);
  const headerRef = React.useRef<HTMLTableSectionElement | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const [state, setState] = React.useState<StickyTableState>(EMPTY_STATE);

  const updateState = React.useCallback(() => {
    const frame = frameRef.current;
    const scroll = scrollRef.current;
    const table = tableRef.current;
    const header = headerRef.current;

    if (!frame || !scroll || !table || !header) {
      setState((current) => (current.visible ? EMPTY_STATE : current));
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const headerHeight = Math.ceil(headerRect.height);
    const visible = frameRect.top < 0 && frameRect.bottom > headerHeight;

    if (!visible) {
      setState((current) => (current.visible ? { ...current, visible: false } : current));
      return;
    }

    const columnWidths = Array.from(header.querySelectorAll("th")).map((cell) =>
      Math.ceil(cell.getBoundingClientRect().width),
    );
    const nextState: StickyTableState = {
      columnWidths,
      headerHeight,
      left: Math.round(scrollRect.left),
      scrollLeft: Math.round(scroll.scrollLeft),
      tableWidth: Math.ceil(Math.max(tableRect.width, scroll.clientWidth)),
      visible,
      width: Math.round(scrollRect.width),
    };

    setState((current) => (sameState(current, nextState) ? current : nextState));
  }, []);

  const scheduleUpdate = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateState();
    });
  }, [updateState]);

  React.useLayoutEffect(() => {
    scheduleUpdate();
  });

  React.useEffect(() => {
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [scheduleUpdate]);

  return (
    <div className="sticky-table-frame" ref={frameRef}>
      {state.visible ? (
        <div
          className="floating-table-header"
          style={{
            height: state.headerHeight,
            left: state.left,
            width: state.width,
          }}
        >
          <div
            className="floating-table-header-inner"
            style={{ transform: `translateX(${-state.scrollLeft}px)` }}
          >
            <table className={className} style={{ minWidth: state.tableWidth, width: state.tableWidth }}>
              <colgroup>
                {state.columnWidths.map((width, index) => (
                  <col key={index} style={{ width }} />
                ))}
              </colgroup>
              <thead>{renderHeader()}</thead>
            </table>
          </div>
        </div>
      ) : null}
      <div className="table-scroll" onScroll={scheduleUpdate} ref={scrollRef}>
        <table className={className} ref={tableRef}>
          <thead ref={headerRef}>{renderHeader()}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
