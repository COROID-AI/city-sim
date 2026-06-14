    <aside
      role="log"
      aria-live="polite"
      aria-label="City event log"
      style={containerStyle}
      data-testid="city-log"
      data-event-log="event-log"
    >
      <header style={headerStyle}>
        <span style={titleStyle}>City Log</span>
        <span style={countStyle}>{entries.length}/20</span>
      </header>
      <ul style={listStyle}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            style={rowStyle}
            data-testid="city-log-row"
            data-kind={entry.kind}
          >
            <span
              aria-hidden
              style={{
                ...dotStyle,
                background: EVENT_DOT_COLOR[entry.kind],
              }}
            />
            <span style={labelStyle}>{EVENT_LABEL[entry.kind]}</span>
            <span style={summaryStyle}>{summarize(entry.kind, entry.payload)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}