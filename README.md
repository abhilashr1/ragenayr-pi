# ragenayr-pi

Personal Pi package with extensions, skills, prompts, and themes.

## Install

```bash
pi install git:github.com/abhilashr1/ragenayr-pi
```

## Sync updates (one command)

Use the sync script from your repo clone:

```bash
~/ragenayr-pi/pisync.sh
```

What it does:
- pulls latest repo changes
- syncs local Pi resources (`extensions`, `prompts`, `skills`, `themes`) into the repo
- commits and pushes only if changes exist
- runs `pi update --extensions`
