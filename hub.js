// Dedicated cPanel/Passenger entrypoint for the OPTIONAL intelligence hub.
// This must be configured as a separate Node.js application from app.js.
// No top-level await: compatible with cPanel's CommonJS-style module loading.
import './bin/intelligence-hub.js';
