import "./global.css";
import { mount } from "svelte";
import { marked } from "marked";
import App from "./App.svelte";

marked.use({ breaks: true, gfm: true });

const app = mount(App, {
  target: document.getElementById("app")
});

export default app;
