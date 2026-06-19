import '@napplet/shim';  // installs window.napplet before any component mounts (NIP-5D)

import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import { installBuiltInThemeClient } from '@hyprgate/utils';
import { mount } from 'svelte';
import App from './App.svelte';

installBuiltInThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;
