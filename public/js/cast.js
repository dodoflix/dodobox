// Google Cast (Chromecast, Android TV, Google TV). The sender SDK loads from Google on demand, only in browsers that support it.
let ready
export function loadCast () {
  if (ready) return ready
  ready = new Promise(resolve => {
    if (!/Chrome|CriOS|Edg/.test(navigator.userAgent) || /iPhone|iPad/.test(navigator.userAgent) || !navigator.onLine) return resolve(false)
    window.__onGCastApiAvailable = ok => {
      if (!ok) return resolve(false)
      try {
        cast.framework.CastContext.getInstance().setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED })
        resolve(true)
      } catch { resolve(false) }
    }
    const s = document.createElement('script')
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
    s.onerror = () => resolve(false)
    document.head.append(s)
    setTimeout(() => resolve(false), 7000)
  })
  return ready
}

// Starts casting; returns a small controller for the player UI.
export async function castTo ({ url, contentType, title, subtitle, image, startAt }) {
  const ctx = cast.framework.CastContext.getInstance()
  await ctx.requestSession()
  const session = ctx.getCurrentSession()
  const info = new chrome.cast.media.MediaInfo(url, contentType)
  info.metadata = new chrome.cast.media.GenericMediaMetadata()
  info.metadata.title = title; info.metadata.subtitle = subtitle
  if (image) info.metadata.images = [new chrome.cast.Image(image)]
  const req = new chrome.cast.media.LoadRequest(info)
  req.currentTime = startAt || 0; req.autoplay = true
  await session.loadMedia(req)
  const player = new cast.framework.RemotePlayer()
  const ctl = new cast.framework.RemotePlayerController(player)
  const E = cast.framework.RemotePlayerEventType
  return {
    device: session.getCastDevice().friendlyName,
    get time () { return player.currentTime },
    get paused () { return player.isPaused },
    toggle: () => ctl.playOrPause(),
    stop: () => { const t = player.currentTime; ctx.endCurrentSession(true); return t },
    on (fn) {
      for (const t of [E.CURRENT_TIME_CHANGED, E.IS_PAUSED_CHANGED, E.IS_CONNECTED_CHANGED]) ctl.addEventListener(t, () => fn(player))
    }
  }
}
