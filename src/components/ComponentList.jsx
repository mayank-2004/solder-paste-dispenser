export default function ComponentList({ components, originIdx, onFocus, onSetHome }) {
  return (
    <div className="card components">
      {/* <h3>Components</h3> */}
      {components.length === 0 ? (
        <div>No components inferred yet.</div>
      ) : (
        <ul className="comp-list">
          {components.map((c, i) => (
            <li key={i} className={`comp-item ${i === originIdx ? "home" : ""}`}>
              <div className="comp-meta">
                <span className="comp-name">Comp #{i + 1}</span>
                {i === originIdx && <span className="badge-home">Home</span>}
              </div>

              {/* <div className="comp-dist">
                {c.dist != null ? `${c.dist.toFixed(2)} mm` : "—"}
              </div> */}

              <div className="comp-actions">
                <button className="btn secondary" onClick={() => onFocus(c)}>
                  Focus
                </button>
                <button className="btn" onClick={() => onSetHome(i)}>
                  Set Home
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
