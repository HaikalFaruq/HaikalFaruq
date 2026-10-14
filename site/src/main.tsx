import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/geist"
import "./index.css"
import App from "./app"

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// The calendar draws its labels on a canvas, which only uses Geist once the
// font has loaded, so wait for it, but not for long.
const font = document.fonts.load('400 10px "Geist Variable"')
Promise.race([font, new Promise((resolve) => setTimeout(resolve, 1500))]).then(render, render)
