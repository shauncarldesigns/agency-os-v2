import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
// Tailwind utilities + light-mode isolation for the Automated Pipeline page.
// Imported after global.css so its rules can override where they need to.
import './styles/pipeline-scope.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
