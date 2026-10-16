/**
 * A still of the workspace, drawn in markup rather than shipped as a screenshot.
 *
 * A product page should show the product, and Postman's does. A PNG would be heavier,
 * would blur on a HiDPI display, and would drift out of date the moment the real UI
 * changes. This is built from the same tokens as the app, so it follows the theme and
 * stays honest about what the tool looks like.
 *
 * Entirely decorative: hidden from assistive technology, since every claim it makes
 * visually is also written out in the surrounding copy.
 */
export default function WorkspacePreview() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview__chrome">
        <span className="preview__dot" />
        <span className="preview__dot" />
        <span className="preview__dot" />
      </div>

      <div className="preview__body">
        <aside className="preview__sidebar">
          <div className="preview__side-head">Collections</div>
          <div className="preview__tree">
            <div className="preview__collection">Petstore API</div>
            <div className="preview__req">
              <span className="preview__m preview__m--get">GET</span> List pets
            </div>
            <div className="preview__req preview__req--active">
              <span className="preview__m preview__m--post">POST</span> Create pet
            </div>
            <div className="preview__req">
              <span className="preview__m preview__m--get">GET</span> Get pet by id
            </div>
            <div className="preview__req">
              <span className="preview__m preview__m--del">DEL</span> Delete pet
            </div>
            <div className="preview__collection">Auth service</div>
            <div className="preview__req">
              <span className="preview__m preview__m--post">POST</span> Login
            </div>
            <div className="preview__req">
              <span className="preview__m preview__m--ws">WS</span> Live feed
            </div>
          </div>
        </aside>

        <div className="preview__main">
          <div className="preview__urlbar">
            <span className="preview__select">REST</span>
            <span className="preview__select preview__select--post">POST</span>
            <span className="preview__url">https://api.example.com/pets</span>
            <span className="preview__send">Send</span>
          </div>

          <div className="preview__tabs">
            <span className="preview__tab">Params</span>
            <span className="preview__tab">Headers</span>
            <span className="preview__tab">Body</span>
            <span className="preview__tab">Auth</span>
            <span className="preview__tab preview__tab--active">Tests</span>
            <span className="preview__tab">Capture</span>
          </div>

          <div className="preview__tests">
            <div className="preview__assert">
              <span className="preview__chip">Status code</span>
              <span className="preview__chip">equals</span>
              <span className="preview__chip preview__chip--val">201</span>
            </div>
            <div className="preview__assert">
              <span className="preview__chip">JSON body</span>
              <span className="preview__chip">$.name</span>
              <span className="preview__chip">equals</span>
              <span className="preview__chip preview__chip--val">{'{{petName}}'}</span>
            </div>
          </div>

          <div className="preview__resp-head">
            <span className="preview__status">201 Created</span>
            <span className="preview__meta">128 ms</span>
            <span className="preview__meta">243 B</span>
            <span className="preview__pass">2 / 2 passed</span>
          </div>

          <pre className="preview__json">
{`{
  "id": 42,
  "name": "Mitten",
  "status": "available"
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
