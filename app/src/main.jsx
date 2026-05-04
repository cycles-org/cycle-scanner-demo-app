import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// FintaChart resource paths — must be set BEFORE any new FintaChart.Chart() call.
// vite.config.js copies these folders from node_modules into /public/vendor/fintachart.
window.FintaChart.ResourcePath.localization = '/vendor/fintachart/localization/';
window.FintaChart.ResourcePath.htmlDialogs  = '/vendor/fintachart/htmldialogs/';
window.FintaChart.SvgLoader.path            = '/vendor/fintachart/img/svg-icons/';

createRoot(document.getElementById('root')).render(<App />);
