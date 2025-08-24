<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Inter&size=28&duration=2800&pause=600&center=true&vCenter=true&width=650&lines=Assal%C4%81mu'alaikum%2C+I'm+Haikal+Faruq+%F0%9F%91%8B;Software+Engineer+%7C+Full%E2%80%91Stack+Developer;Learning+daily+and+shipping+useful+things" alt="Typing SVG" />
</p>

<p align="center">
  <a href="https://github.com/HaikalFaruq?tab=followers"><img alt="Followers" src="https://img.shields.io/github/followers/HaikalFaruq?style=flat&label=Followers"></a>
  <a href="https://github.com/HaikalFaruq"><img alt="Profile Views" src="https://komarev.com/ghpvc/?username=HaikalFaruq&style=flat"></a>
  <a href="https://www.linkedin.com/in/muhammad-haikal-faruq-923b62336/"><img alt="LinkedIn" src="https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white"></a>
  <a href="mailto:haikalfaruq06@gmail.com"><img alt="Email" src="https://img.shields.io/badge/Email-contact-orange"></a>
</p>

---

### 👨‍💻 About me
Hey! I'm **Haikal Faruq** — a software engineer who loves mixing solid engineering with clean, user‑friendly design. I build full‑stack apps (frontend + backend), tinker with data/AI, and enjoy teaching what I learn.

- 🧭 Interests: Frontend/Backend dev, DX, automation, a bit of data/AI
- 🌱 Currently exploring: modern React/Next.js, Node/Express, Python data tooling

---

### 🧰 Tech & Tools I use
<p>
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=js,ts,html,css,react,vue,tailwind,bootstrap,vite,webpack,redux,nodejs,express,python,java,go,fastapi,flask,postgres,mysql,mongodb,redis,prisma,sequelize,git,github,linux,docker,kubernetes,nginx,vercel,netlify,aws,gcp" alt="skills"/>
  </a>
</p>

> *Inspired by **sinlov**'s “Things I code with” grid and **danielcshn**'s Technology Stack section.*

---

### 📊 GitHub Stats
<p align="center">
  <img height="165" src="https://github-readme-stats.vercel.app/api?username=HaikalFaruq&show_icons=true" />
  <img height="165" src="https://streak-stats.demolab.com?user=HaikalFaruq" />
</p>
<p align="center">
  <img height="165" src="https://github-readme-stats.vercel.app/api/top-langs/?username=HaikalFaruq&layout=compact" />
</p>

---

### 🏆 Trophies
<p align="center">
  <img src="https://github-profile-trophy.vercel.app/?username=HaikalFaruq&margin-w=8&margin-h=8" />
</p>

---

### 📈 Activity Graph
<p align="center">
  <img src="https://github-readme-activity-graph.vercel.app/graph?username=HaikalFaruq&radius=8&hide_border=true" />
</p>

---

### 🎧 Spotify (Optional)
<p align="center">
  <img src="https://spotify-github-profile.vercel.app/api/view?uid=wjwh89f8gjska6137zg7e81vl&cover_image=true&theme=default&show_offline=false&background_color=121212&interchange=false&bar_color=53b14f&bar_color_cover=true" alt="Spotify Now Playing"/>
</p>

---

### 🧱 3D Contribution Graph (Optional)
<p align="center">
  <img src="./profile-3d-contrib/profile-night-rainbow.svg" alt="3D profile contributions"/>
</p>

---

### ⏱️ WakaTime (Optional)
<!-- Requires WakaTime account + GitHub Action (athul/waka-readme). The block below will auto‑fill each day. -->
<!--START_SECTION:waka-->

```txt
From: 16 August 2025 - To: 23 August 2025

No activity tracked
```

<!--END_SECTION:waka-->
```

---

### 2) 3D Contribution Graph (SVGs committed to repo)
Create file: **`.github/workflows/profile-3d.yml`**
```yaml
name: Generate 3D Contributions
on:
  schedule:
    - cron: '0 17 * * *'  # 00:00 WIB daily
  workflow_dispatch:
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: yoshi389111/github-profile-3d-contrib@0.9.1
        with:
          username: HaikalFaruq
          token: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit & push
        run: |
          if [[ -n $(git status --porcelain) ]]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add -A
            git commit -m "chore: update 3D contribution graphs"
            git push
          fi
```

This will generate files under `profile-3d-contrib/`. The README already references:
```
./profile-3d-contrib/profile-night-rainbow.svg
```

---

### 3) Spotify Now Playing (via Vercel)
Two options:
- **Recommended:** Deploy your own `spotify-github-profile` on Vercel for maximum reliability.
  1. Fork `kittinan/spotify-github-profile` and click **Deploy to Vercel**.
  2. In Vercel project settings → **Environment Variables**, add: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`.
  3. After deploy, copy your Vercel URL (e.g., `https://your-app.vercel.app/api/view?uid=YOUR_UID&cover_image=true...`).
  4. In README, replace the `<img src=...>` under **🎧 Spotify** with your Vercel URL (and your UID).
- **Alternative:** If you already have a hosted endpoint, just replace the `src` in the `<img>`.

---

### 4) Widgets (Stats, Streak, Top Languages, Trophies, Activity Graph)
These are already wired using image endpoints; **no secrets needed**. They will display automatically.

> If any image fails to load intermittently, it’s usually rate‑limit or upstream downtime. It resolves on refresh or next commit.

---

### 5) Optional: Shields/Skill Icons
Already enabled via `skillicons.dev` and shields URLs; no config required. Update icons by editing the `i=` list in the README.

---

## 🔐 Secrets to add (Settings → Secrets and variables → Actions)
- `WAKATIME_API_KEY` → your WakaTime API Key
- *(If you deploy Spotify on Vercel — set these on **Vercel**, not GitHub):*
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REFRESH_TOKEN`

---

## 🧪 Quick test checklist
- Actions → run **Update WakaTime stats in README** once. Confirm the Waka section updates.
- Actions → run **Generate 3D Contributions** once. Check `profile-3d-contrib/` SVGs render.
- Update the Spotify `<img>` to your Vercel URL and preview.
