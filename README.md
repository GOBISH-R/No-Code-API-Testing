# ApIForge

ApIForge is a website for testing APIs without writing code. You build a request, send it, and see the
response, then check that the API works the way it should. All by clicking, not coding.

**Live site: https://apiforge-m2ir.onrender.com**

## Features

### Sending requests
- **REST, GraphQL and WebSocket**: test all three kinds of API from one place.
- **Request builder**: choose the method (GET, POST, PUT, PATCH, DELETE), then add query parameters,
  headers and a body: JSON, form data, file uploads or plain text.
- **Authorization**: send login details with a request: Basic, Bearer token, API key or OAuth 2.0.
- **cURL import**: paste a cURL command into the address bar and the whole request fills itself in.
- **Code snippets**: turn any request into ready-to-use code (cURL, JavaScript, Node.js, Python or
  PowerShell) with one click.

### GraphQL and WebSocket
- **GraphQL schema explorer**: load an API's schema to get suggestions while you type, catch mistakes
  before sending, and browse every type and field.
- **WebSocket console**: connect, send messages and watch replies arrive live.
- **WebSocket steps**: script a conversation (send, wait for a reply, check it) and run it in one go.

### Responses
- **Response viewer**: see the status, time and size, with the body neatly formatted.
- **Timing breakdown**: see where the time went: connecting, waiting for the server, downloading.
- **Search, copy and save**: find text inside a response, copy it, or save it as a file.

### Testing without code
- **Tests (assertions)**: add simple checks like "status is 200" or "name contains Ada" and see each
  one pass or fail.
- **Captures**: take a value from a response (like a login token) and use it in the next request
  automatically. This is called request chaining.

### Variables
- **Environments**: keep sets of values like `{{baseUrl}}` for Development, Staging and Production,
  and switch between them in one click.
- **Globals**: values every request can use, whichever environment is chosen.

### Collections and running
- **Collections and folders**: save requests and keep them organised.
- **Collection runner**: run every request in a collection in order, with captures carried along.
- **Data-driven runs**: run a collection once for every row of a CSV or JSON file.
- **Runs and reports**: look back at past runs, and save any run as a PDF report.
- **Dashboard**: pass rates, failures over the last 14 days and recent runs at a glance.

### Automation
- **Monitors**: run a collection on a schedule, from every 5 minutes to once a day.
- **Alerts**: get an email or a webhook message (Slack, Discord, Teams) when a monitor starts failing,
  and again when it is fixed.

### Mock server
- **Mock endpoints**: make fake API endpoints with the response you want, so you can test before the
  real API exists.

### History and sharing
- **History**: every request you send is kept, grouped by day, and can be reopened with one click.
- **Import and export**: share collections as files, or create one straight from an **OpenAPI /
  Swagger** file.
- **Team workspaces**: share collections, environments and monitors with your team, inviting people as
  **Editors** (can change things) or **Viewers** (can look and run, but not change).

## Try it

Open **https://apiforge-m2ir.onrender.com**, create an account, and start testing. Nothing to install.
