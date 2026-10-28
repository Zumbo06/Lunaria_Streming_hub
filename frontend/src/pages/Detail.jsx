import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, CalendarClock, Captions, Clapperboard, Film, History, Loader2,
  MonitorPlay, Play, RotateCcw, Star, Tv, X,
} from 'lucide-react'
import {
  appApi, creditsOf, formatAirDate, formatRemaining, formatRuntime, isReleased, metaApi, nextEpisodeAfter,
  nextRequestId, playApi, playersApi, progressApi, streamsApi, subtitlesApi, trailerUrlOf, videoIdOf, watchlistApi,
} from '../api/orion.js'
import { usePlayer } from '../components/PlayerProvider.jsx'
import EpisodeList from '../components/EpisodeList.jsx'
import StreamList from '../components/StreamList.jsx'
import Badge from '../components/Badge.jsx'

// Matches STARTED_AT in electron/library.js: below this a title was opened, not watched.
const STARTED_AT = 0.01

// Longer descriptions are clamped behind a "More" toggle.
const LONG_DESCRIPTION = 280

const TYPE_LABELS = { movie: 'Movie', series: 'Series' }

function episodeLabel(season, episode) {
  return season != null && episode != null ? `S${season}:E${episode}` : null
}

/**
 * Detail panel: backdrop, metadata and the resolved stream links for the item
 * (UI 3.1). For a series the stream and subtitle queries are both keyed to the
 * selected episode id.
 */
export default function Detail() {
  const { type, id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { play, resumeEntry, busyStreamId, engine, applySubtitleNow } = usePlayer()

  const decodedId = decodeURIComponent(id)

  // Set when Continue watching sends someone here: which episode they were on,
  // which release they used, and why it could not simply be resumed. Home's
  // showcase sets `focusStreams` so "Watch" lands on the sources.
  const { episodeId: requestedEpisodeId, highlightSourceId, resumeFailed, focusStreams } = location.state || {}
  const [resumeNotice, setResumeNotice] = useState(null)

  useEffect(() => {
    setResumeNotice(resumeFailed || null)
  }, [resumeFailed])

  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [logoFailed, setLogoFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [selectedSeason, setSelectedSeason] = useState(null)
  const [episodeId, setEpisodeId] = useState(null)

  const [groups, setGroups] = useState([])
  const [streamErrors, setStreamErrors] = useState([])
  const [loadingStreams, setLoadingStreams] = useState(false)
  const [language, setLanguage] = useState('all')
  const [autoLanguage, setAutoLanguage] = useState(null)
  const [saved, setSaved] = useState(false)
  const [subtitleGroups, setSubtitleGroups] = useState([])
  const [loadingSubtitles, setLoadingSubtitles] = useState(false)
  const [subtitleId, setSubtitleId] = useState('')
  const streamRequest = useRef(null)

  const [progress, setProgress] = useState({})
  const [progressLoaded, setProgressLoaded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [streamsFocus, setStreamsFocus] = useState(0)
  const progressRequest = useRef(0)
  const streamsRef = useRef(null)
  const focusHandled = useRef(null)

  const isSeries = type === 'series'
  const streamTargetId = isSeries ? episodeId : decodedId

  // ---- Metadata ----

  useEffect(() => {
    let cancelled = false
    setLoadingMeta(true)
    setMeta(null)
    setMetaError(null)
    setLogoFailed(false)
    setExpanded(false)
    setEpisodeId(null)
    setSelectedSeason(null)

    metaApi.get(type, decodedId).then((result) => {
      if (cancelled) return
      if (result.ok) setMeta(result.meta)
      else setMetaError(result.error)
      setLoadingMeta(false)
    })

    return () => {
      cancelled = true
    }
  }, [type, decodedId])

  const seasons = useMemo(() => {
    if (!Array.isArray(meta?.videos)) return []

    const bySeason = new Map()
    for (const video of meta.videos) {
      const season = Number(video.season ?? 0)
      if (!bySeason.has(season)) bySeason.set(season, [])
      bySeason.get(season).push(video)
    }

    return [...bySeason.entries()]
      .map(([season, videos]) => ({
        season,
        videos: videos.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
      }))
      // Specials (season 0) sit after the numbered seasons.
      .sort((a, b) => (a.season === 0) - (b.season === 0) || a.season - b.season)
  }, [meta])

  const findEpisode = useCallback(
    (videoId) => {
      for (const entry of seasons) {
        const video = entry.videos.find((item) => videoIdOf(item, decodedId) === videoId)
        if (video) return { season: entry.season, video }
      }
      return null
    },
    [seasons, decodedId],
  )

  const selectEpisode = useCallback(
    (videoId) => {
      const found = findEpisode(videoId)
      if (!found) return false
      setSelectedSeason(found.season)
      setEpisodeId(videoId)
      return true
    },
    [findEpisode],
  )

  useEffect(() => {
    if (seasons.length > 0 && selectedSeason === null) setSelectedSeason(seasons[0].season)
  }, [seasons, selectedSeason])

  // Arriving from Continue watching: open on the episode that was being
  // watched instead of the first one of season one.
  useEffect(() => {
    if (requestedEpisodeId) selectEpisode(requestedEpisodeId)
  }, [requestedEpisodeId, selectEpisode])

  // ---- Progress ----

  const loadProgress = useCallback(async () => {
    const token = ++progressRequest.current
    let next = {}

    try {
      if (isSeries) {
        next = (await progressApi.series(type, decodedId)) || {}
      } else {
        const entry = await progressApi.get(type, decodedId)
        if (entry) next = { [decodedId]: entry }
      }
    } catch {
      next = {}
    }

    if (token !== progressRequest.current) return
    setProgress(next)
    setProgressLoaded(true)
  }, [isSeries, type, decodedId])

  useEffect(() => {
    setProgress({})
    setProgressLoaded(false)
    loadProgress()
    // A position is committed when the player closes, so refresh on that.
    return playApi.onEnded(loadProgress)
  }, [loadProgress])

  /**
   * What the main button does, worked out from where this profile is:
   * carry on with the release they were using, start the episode after the
   * one they finished, or point at the sources when there is nothing to
   * resume. Films never auto-pick a release for a first watch.
   */
  const primary = useMemo(() => {
    if (!meta) return null

    if (!isSeries) {
      const entry = progress[decodedId]
      if (entry && !entry.finished && entry.percent >= STARTED_AT) {
        return {
          kind: entry.source ? 'resume' : 'streams',
          entry,
          label: 'Resume',
          detail: formatRemaining(entry.positionSeconds, entry.durationSeconds),
        }
      }
      return entry?.finished
        ? { kind: 'streams', label: 'Watch again', again: true }
        : { kind: 'streams', label: 'Play' }
    }

    if (seasons.length === 0) return null

    const latest = Object.values(progress).reduce(
      (newest, entry) => (!newest || (entry.updatedAt || 0) > (newest.updatedAt || 0) ? entry : newest),
      null,
    )

    if (latest && !latest.finished) {
      const label = episodeLabel(latest.season, latest.episode)
      if (latest.percent >= STARTED_AT) {
        return {
          kind: latest.source ? 'resume' : 'select',
          entry: latest,
          videoId: latest.videoId,
          label: label ? `Resume ${label}` : 'Resume',
          detail: formatRemaining(latest.positionSeconds, latest.durationSeconds),
        }
      }
      if (findEpisode(latest.videoId)) {
        return { kind: 'select', videoId: latest.videoId, label: label ? `Play ${label}` : 'Play' }
      }
    }

    if (latest?.finished) {
      // A special watched in between leads nowhere in the main run, so carry
      // on from the newest finished numbered episode instead.
      const anchor =
        Number(latest.season) === 0 && !nextEpisodeAfter(seasons, latest.videoId, decodedId)
          ? Object.values(progress)
              .filter((entry) => entry.finished && Number(entry.season) !== 0)
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || latest
          : latest

      const next = nextEpisodeAfter(seasons, anchor.videoId, decodedId)
      if (next) {
        return {
          kind: 'next',
          video: next,
          previous: anchor,
          videoId: videoIdOf(next, decodedId),
          label: `Play ${episodeLabel(Number(next.season ?? 0), next.episode)}`,
        }
      }

      // Caught up on a show that is still airing: say when the next one lands
      // instead of offering to start again from the top.
      const upcoming = seasons
        .filter((entry) => entry.season !== 0)
        .flatMap((entry) => entry.videos)
        .find((video) => !isReleased(video))
      if (upcoming) {
        const airs = formatAirDate(upcoming.released || upcoming.firstAired)
        return { kind: 'none', label: 'Caught up', detail: airs ? `next episode ${airs}` : null }
      }
    }

    const first = seasons[0].videos.find(isReleased)
    if (!first) return null

    const label = episodeLabel(Number(first.season ?? 0), first.episode)
    return latest?.finished
      ? { kind: 'select', videoId: videoIdOf(first, decodedId), label: `Watch again · ${label}`, again: true }
      : { kind: 'select', videoId: videoIdOf(first, decodedId), label: `Start watching · ${label}` }
  }, [meta, isSeries, progress, decodedId, seasons, findEpisode])

  // Open a series on the episode the main button points at, so the streams
  // for it are already loading instead of the page asking for a pick.
  useEffect(() => {
    if (!isSeries || episodeId || seasons.length === 0 || !progressLoaded) return
    if (requestedEpisodeId && findEpisode(requestedEpisodeId)) return
    if (primary?.videoId) selectEpisode(primary.videoId)
  }, [isSeries, episodeId, seasons, progressLoaded, requestedEpisodeId, findEpisode, primary, selectEpisode])

  // ---- Streams (REQ-2.1) ----

  useEffect(() => {
    const unsubscribe = streamsApi.onPartial(({ requestId, groups: partial }) => {
      if (requestId !== streamRequest.current) return
      setGroups(partial)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!streamTargetId) {
      streamRequest.current = null
      setGroups([])
      setStreamErrors([])
      setLoadingStreams(false)
      return undefined
    }

    let cancelled = false
    const requestId = nextRequestId()
    streamRequest.current = requestId

    setLoadingStreams(true)
    setGroups([])
    setStreamErrors([])

    streamsApi.get(type, streamTargetId, requestId).then((result) => {
      if (cancelled || streamRequest.current !== requestId) return
      setGroups(result.groups || [])
      setStreamErrors(result.errors || [])
      setLoadingStreams(false)

      // Narrow to the preferred audio language, but only when something
      // actually offers it — otherwise the list would look empty when most
      // releases simply carry no language tag at all.
      const available = new Set(
        (result.groups || []).flatMap((group) => group.streams.flatMap((stream) => stream.languages || [])),
      )
      const match = (result.preferredAudio || []).find((entry) => available.has(entry))

      setAutoLanguage(match || null)
      setLanguage(match || 'all')
    })

    return () => {
      cancelled = true
    }
  }, [type, streamTargetId])

  const requestStreamsFocus = useCallback(() => setStreamsFocus((count) => count + 1), [])

  // Bring the sources into view and put keyboard focus on the first one, or on
  // the section while they are still loading.
  useEffect(() => {
    if (!streamsFocus) return
    const section = streamsRef.current
    if (!section) return

    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const firstStream = section.querySelector('ul button:not(:disabled)')
    ;(firstStream || section).focus({ preventScroll: true })
  }, [streamsFocus])

  useEffect(() => {
    if (!focusStreams || !meta || focusHandled.current === location.key) return
    if (isSeries && !episodeId) return
    focusHandled.current = location.key
    requestStreamsFocus()
  }, [focusStreams, meta, isSeries, episodeId, location.key, requestStreamsFocus])

  // ---- Subtitles ----

  useEffect(() => {
    if (!streamTargetId) {
      setSubtitleGroups([])
      setSubtitleId('')
      return undefined
    }

    let cancelled = false
    setLoadingSubtitles(true)
    setSubtitleGroups([])
    setSubtitleId('')

    subtitlesApi.get(type, streamTargetId).then((result) => {
      if (cancelled) return
      setSubtitleGroups(result.groups || [])
      setLoadingSubtitles(false)
    })

    return () => {
      cancelled = true
    }
  }, [type, streamTargetId])

  const selectedSubtitle = useMemo(() => {
    if (!subtitleId) return null
    for (const group of subtitleGroups) {
      const track = group.tracks.find((entry) => entry.id === subtitleId)
      if (track) return track
    }
    return null
  }, [subtitleId, subtitleGroups])

  // ---- Player / HDR ----

  const [playerInfo, setPlayerInfo] = useState(null)

  useEffect(() => {
    playersApi.detect().then((detected) => {
      setPlayerInfo({ ...detected.players[detected.selected], selected: detected.selected })
    })
  }, [])

  const hasHdrStream = useMemo(
    () => groups.some((group) => group.streams.some((stream) => stream.isHdr)),
    [groups],
  )

  const subtitleCount = useMemo(
    () => subtitleGroups.reduce((total, group) => total + group.tracks.length, 0),
    [subtitleGroups],
  )

  // ---- Watchlist ----

  useEffect(() => {
    watchlistApi.has(type, decodedId).then(setSaved)
  }, [type, decodedId])

  const toggleWatchlist = useCallback(async () => {
    if (saved) {
      await watchlistApi.remove(type, decodedId)
      setSaved(false)
    } else {
      await watchlistApi.add({
        type,
        id: decodedId,
        name: meta?.name,
        poster: meta?.poster,
        releaseInfo: meta?.releaseInfo,
      })
      setSaved(true)
    }
  }, [saved, type, decodedId, meta])

  // ---- Language filter ----

  const availableLanguages = useMemo(() => {
    const seen = new Set()
    for (const group of groups) {
      for (const stream of group.streams) {
        for (const entry of stream.languages || []) seen.add(entry)
      }
    }
    return [...seen].sort()
  }, [groups])

  const visibleGroups = useMemo(() => {
    if (language === 'all') return groups
    return groups
      .map((group) => ({
        ...group,
        streams: group.streams.filter((stream) => (stream.languages || []).includes(language)),
      }))
      .filter((group) => group.streams.length > 0)
  }, [groups, language])

  const selectedVideo = useMemo(
    () => (isSeries && episodeId ? findEpisode(episodeId)?.video || null : null),
    [isSeries, episodeId, findEpisode],
  )

  const playItem = useMemo(
    () => ({
      type,
      id: decodedId,
      videoId: streamTargetId,
      name: meta?.name,
      poster: meta?.poster,
      background: meta?.background,
      thumbnail: selectedVideo?.thumbnail || null,
      season: isSeries ? Number(selectedSeason) : null,
      episode: isSeries ? selectedVideo?.episode ?? null : null,
      episodeTitle: selectedVideo?.title || selectedVideo?.name || null,
      releaseInfo: meta?.releaseInfo,
      imdbRating: meta?.imdbRating,
    }),
    [type, decodedId, streamTargetId, meta, isSeries, selectedSeason, selectedVideo],
  )

  async function runPrimary() {
    if (!primary || starting) return

    if (primary.kind === 'streams') {
      requestStreamsFocus()
      return
    }

    if (primary.kind === 'select') {
      selectEpisode(primary.videoId)
      requestStreamsFocus()
      return
    }

    setStarting(true)
    try {
      if (primary.kind === 'resume') {
        if (isSeries) selectEpisode(primary.entry.videoId)
        await resumeEntry({
          ...primary.entry,
          type,
          id: decodedId,
          background: primary.entry.background || meta.background || null,
        })
      } else if (primary.kind === 'next') {
        const { video, previous } = primary
        selectEpisode(primary.videoId)
        // The same path as an "up next" card on Home, so the release is
        // matched to the previous episode's in exactly the same way.
        await resumeEntry({
          type,
          id: decodedId,
          videoId: primary.videoId,
          name: meta.name,
          poster: meta.poster,
          background: meta.background || null,
          thumbnail: video.thumbnail || null,
          season: Number(video.season ?? 0),
          episode: video.episode,
          episodeTitle: video.title || video.name || null,
          upNext: true,
          previousSource: previous.source || null,
          previousSubtitle: previous.subtitle || null,
        })
      }
    } finally {
      setStarting(false)
    }
  }

  // ---- Render ----

  if (loadingMeta) {
    return (
      <div className="page pt-5">
        <div className="skeleton h-7 w-20" />
        <div className="flex flex-col gap-8 pt-10 sm:flex-row">
          <div className="skeleton aspect-[2/3] w-[220px] shrink-0 rounded-xl" />
          <div className="flex-1 space-y-3 pt-2">
            <div className="skeleton h-12 w-2/5" />
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-full max-w-3xl" />
            <div className="skeleton h-3 w-4/5 max-w-3xl" />
            <div className="flex gap-2.5 pt-3">
              <div className="skeleton h-10 w-40" />
              <div className="skeleton h-10 w-28" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (metaError || !meta) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="rounded-2xl bg-ink-850 p-4 text-rose-300 ring-1 ring-rose-500/20">
          <AlertTriangle size={26} />
        </div>
        <h2 className="mt-5 text-[15px] font-semibold text-slate-100">Metadata unavailable</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-haze">
          {metaError || 'No installed addon could describe this item.'}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="focus-ring mt-6 rounded-lg bg-ink-800 px-4 py-2 text-[13px] font-medium text-slate-200 transition hover:bg-ink-700"
        >
          Go back
        </button>
      </div>
    )
  }

  const rawGenres = meta.genres || meta.genre
  const genres = Array.isArray(rawGenres) ? rawGenres : []
  const runtime = formatRuntime(meta.runtime)
  const seasonCount = seasons.filter((entry) => entry.season !== 0).length
  const trailerUrl = trailerUrlOf(meta)
  const description = typeof meta.description === 'string' ? meta.description : ''
  const longDescription = description.length > LONG_DESCRIPTION

  const facts = [
    meta.releaseInfo || meta.year,
    runtime,
    TYPE_LABELS[type] || type,
    isSeries && typeof meta.status === 'string' && meta.status,
    seasonCount > 0 && `${seasonCount} ${seasonCount === 1 ? 'season' : 'seasons'}`,
  ].filter(Boolean)

  const { directors, writers, cast } = creditsOf(meta)
  const directorLabel = directors.length > 1 ? 'Directors' : 'Director'
  const country = typeof meta.country === 'string' ? meta.country : null
  const awards = typeof meta.awards === 'string' && meta.awards !== 'N/A' ? meta.awards : null

  // Cinemeta has no director for a series and lists its creators as writers.
  const credits = [
    ...(isSeries
      ? [
          { label: 'Created by', names: writers },
          { label: directorLabel, names: directors },
        ]
      : [
          { label: directorLabel, names: directors },
          { label: writers.length > 1 ? 'Writers' : 'Writer', names: writers },
        ]),
    { label: 'Starring', names: cast, wide: true },
    { label: 'Country', names: country ? [country] : [] },
    { label: 'Awards', names: awards ? [awards] : [] },
  ].filter((entry) => entry.names.length > 0)

  const secondaryButton =
    'focus-ring flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium ring-1 backdrop-blur transition'

  return (
    <div className="pb-28">
      {/* Backdrop */}
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[560px] overflow-hidden">
          {meta.background && (
            <img
              src={meta.background}
              alt=""
              decoding="async"
              className="h-full w-full object-cover object-top opacity-80"
            />
          )}
          {/* Bounded scrims, as on the Home showcase: the text column gets a
              solid base and the artwork on the right is left mostly alone. */}
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 via-45% to-ink-950/20" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />
        </div>

        <div className="relative page pt-5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-900/70 px-3 py-1.5 text-[12px] font-medium text-slate-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-800 hover:text-white"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div className="flex flex-col gap-8 pt-10 sm:flex-row">
            {/* Poster with Reactive Ambient Lighting Glow */}
            <div className="relative group w-[220px] shrink-0 self-start">
              {meta.poster && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-3 rounded-2xl opacity-50 blur-2xl filter saturate-150 transition-opacity duration-700"
                  style={{
                    backgroundImage: `url(${meta.poster})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              )}
              <div className="relative overflow-hidden rounded-xl bg-ink-800 shadow-2xl ring-1 ring-white/10">
                {meta.poster ? (
                  <img src={meta.poster} alt="" decoding="async" className="aspect-[2/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] items-center justify-center text-ink-500">
                    {isSeries ? <Tv size={30} /> : <Film size={30} />}
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-lg">
                {meta.logo && !logoFailed ? (
                  <img
                    src={meta.logo}
                    alt={meta.name}
                    decoding="async"
                    onError={() => setLogoFailed(true)}
                    className="max-h-28 w-auto max-w-[min(420px,100%)] object-contain object-left drop-shadow-lg"
                  />
                ) : (
                  meta.name
                )}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-300">
                {meta.imdbRating && (
                  <span className="flex items-center gap-1 font-semibold text-amber-300">
                    <Star size={13} className="fill-amber-300" />
                    {meta.imdbRating}
                  </span>
                )}
                {facts.map((fact, index) => (
                  <Fragment key={fact}>
                    {(index > 0 || meta.imdbRating) && (
                      <span aria-hidden="true" className="text-ink-500">
                        ·
                      </span>
                    )}
                    <span>{fact}</span>
                  </Fragment>
                ))}
              </div>

              {genres.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {genres.slice(0, 6).map((genre) => (
                    <Badge key={genre}>{genre}</Badge>
                  ))}
                </div>
              )}

              {description && (
                <div className="mt-4 max-w-3xl">
                  <p
                    className={`text-[14px] leading-relaxed text-slate-300 ${
                      longDescription && !expanded ? 'line-clamp-3' : ''
                    }`}
                  >
                    {description}
                  </p>
                  {longDescription && (
                    <button
                      type="button"
                      onClick={() => setExpanded((open) => !open)}
                      aria-expanded={expanded}
                      className="focus-ring mt-1 rounded text-[12px] font-medium text-accent-soft transition hover:text-white"
                    >
                      {expanded ? 'Less' : 'More'}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {primary &&
                  (primary.kind === 'none' ? (
                    <span className="flex items-center gap-2 rounded-lg bg-ink-800/80 px-4 py-2.5 text-[13px] font-medium text-slate-200 ring-1 ring-white/10 backdrop-blur">
                      <CalendarClock size={15} className="text-accent-soft" />
                      {primary.label}
                      {primary.detail && <span className="text-haze">· {primary.detail}</span>}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={runPrimary}
                      disabled={starting}
                      className="focus-ring flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-semibold text-ink-950 transition hover:bg-accent-soft disabled:opacity-80"
                    >
                      {starting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : primary.again ? (
                        <RotateCcw size={16} />
                      ) : (
                        <Play size={16} className="fill-ink-950" />
                      )}
                      {primary.label}
                      {primary.detail && <span className="font-medium text-ink-950/70">· {primary.detail}</span>}
                    </button>
                  ))}

                {trailerUrl && (
                  <button
                    type="button"
                    onClick={() => appApi.openExternal(trailerUrl)}
                    className={`${secondaryButton} bg-white/10 text-slate-100 ring-white/10 hover:bg-white/20`}
                  >
                    <Clapperboard size={15} />
                    Trailer
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleWatchlist}
                  aria-pressed={saved}
                  className={`${secondaryButton} ${
                    saved
                      ? 'bg-accent/20 text-accent-soft ring-accent/40 hover:bg-accent/30'
                      : 'bg-white/10 text-slate-100 ring-white/10 hover:bg-white/20'
                  }`}
                >
                  {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                  {saved ? 'In watchlist' : 'Watchlist'}
                </button>
              </div>

              {credits.length > 0 && (
                <dl className="mt-7 grid max-w-3xl gap-x-10 gap-y-4 sm:grid-cols-2">
                  {credits.map(({ label, names, wide }) => (
                    <div key={label} className={wide ? 'sm:col-span-2' : ''}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-haze">{label}</dt>
                      <dd className="mt-1 text-[13px] leading-relaxed text-slate-200">{names.join(', ')}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Episodes */}
      {isSeries && seasons.length > 0 && (
        <EpisodeList
          seriesId={decodedId}
          seasons={seasons}
          selectedSeason={selectedSeason}
          onSelectSeason={setSelectedSeason}
          episodeId={episodeId}
          onSelectEpisode={setEpisodeId}
          progress={progress}
        />
      )}

      {/* Streams */}
      <section
        ref={streamsRef}
        tabIndex={-1}
        aria-labelledby="streams-heading"
        className="page scroll-mt-4 pt-10 outline-none"
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="streams-heading" className="text-[17px] font-semibold tracking-tight text-slate-100">
            Streams
            {selectedVideo && (
              <span className="ml-2 text-[13px] font-medium text-haze">
                {episodeLabel(selectedSeason, selectedVideo.episode)}
                {(selectedVideo.title || selectedVideo.name) && ` · ${selectedVideo.title || selectedVideo.name}`}
              </span>
            )}
          </h2>
          {loadingStreams && <Loader2 size={14} className="animate-spin text-accent" />}
          {!loadingStreams && groups.length > 0 && (
            <span className="text-[11px] uppercase tracking-wider text-ink-500">
              {visibleGroups.reduce((total, group) => total + group.streams.length, 0)} of{' '}
              {groups.reduce((total, group) => total + group.streams.length, 0)} sources
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-4">
            {availableLanguages.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-ink-500">Audio</span>
                <select
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value)
                    setAutoLanguage(null)
                  }}
                  className="focus-ring rounded-lg bg-ink-850 px-2.5 py-1.5 text-[12px] text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
                >
                  <option value="all">Any language</option>
                  {availableLanguages.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <Captions size={13} className="text-ink-500" />
              <span className="text-[11px] uppercase tracking-wider text-ink-500">Subtitles</span>
              {loadingSubtitles ? (
                <Loader2 size={13} className="animate-spin text-accent" />
              ) : subtitleCount === 0 ? (
                <span className="text-[12px] text-ink-500">None available</span>
              ) : (
                <select
                  value={subtitleId}
                  onChange={(event) => setSubtitleId(event.target.value)}
                  className="focus-ring max-w-[230px] rounded-lg bg-ink-850 px-2.5 py-1.5 text-[12px] text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
                >
                  <option value="">Off</option>
                  {subtitleGroups.map((group) => (
                    <optgroup key={group.language} label={`${group.language} (${group.tracks.length})`}>
                      {group.tracks.map((track, index) => (
                        <option key={track.id} value={track.id}>
                          {track.label || `${group.language} · track ${index + 1}`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {playerInfo && (
            <Link
              to="/settings"
              className="focus-ring flex items-center gap-1.5 rounded text-[11.5px] text-haze transition hover:text-slate-200"
            >
              <MonitorPlay size={12} />
              Playing with <span className="font-medium text-slate-300">{playerInfo.name}</span>
              {!playerInfo.installed && <span className="text-rose-300">· not installed</span>}
            </Link>
          )}

          {selectedSubtitle && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-accent-soft">
              <Captions size={12} />
              {selectedSubtitle.language} subtitles
            </span>
          )}

          {/* mpv can take a subtitle over IPC while playing; VLC cannot. */}
          {selectedSubtitle && playerInfo?.selected === 'mpv' && engine.active && (
            <button
              type="button"
              onClick={() => applySubtitleNow(selectedSubtitle)}
              className="focus-ring flex items-center gap-1.5 rounded-md bg-accent/15 px-2.5 py-1 text-[11.5px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/25"
            >
              <Captions size={12} />
              Load into mpv now
            </button>
          )}
        </div>

        {autoLanguage === language && autoLanguage && (
          <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-haze">
            <span>
              Filtered to <span className="font-medium text-accent-soft">{autoLanguage}</span>, your preferred audio
              language.
            </span>
            <button
              type="button"
              onClick={() => {
                setLanguage('all')
                setAutoLanguage(null)
              }}
              className="focus-ring rounded px-1 font-medium text-slate-300 underline underline-offset-2 transition hover:text-white"
            >
              Show every source
            </button>
          </p>
        )}

        {hasHdrStream && playerInfo?.selected === 'vlc' && (
          <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-amber-300">
            Some sources here are HDR. VLC 3 can only pass HDR through to a display already in HDR mode and cannot
            tone-map — on an SDR display these will look washed out.{' '}
            <Link to="/settings" className="font-medium underline underline-offset-2">
              Switch to mpv
            </Link>{' '}
            for full HDR handling.
          </p>
        )}

        {resumeNotice && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12.5px] leading-relaxed text-amber-200">
            <History size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">The source you watched this with is no longer usable.</p>
              <p className="mt-0.5 text-amber-300/80">{resumeNotice}</p>
              <p className="mt-1 text-amber-300/80">Pick another source below to carry on where you left off.</p>
            </div>
            <button
              type="button"
              onClick={() => setResumeNotice(null)}
              aria-label="Dismiss"
              className="focus-ring shrink-0 rounded p-0.5 transition hover:text-amber-100"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {streamErrors.length > 0 && (
          <div className="mb-4 flex flex-col gap-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] text-amber-300">
            {streamErrors.map((entry) => (
              <div key={entry.addon} className="flex items-center gap-2">
                <AlertTriangle size={13} />
                <span>
                  {entry.addon}: {entry.error}
                </span>
              </div>
            ))}
          </div>
        )}

        {isSeries && !episodeId ? (
          <p className="rounded-lg bg-ink-850 px-4 py-6 text-center text-[13px] text-haze ring-1 ring-white/5">
            Pick an episode above to list its streams.
          </p>
        ) : loadingStreams && groups.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton h-[62px] w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-lg bg-ink-850 px-4 py-6 text-center text-[13px] text-haze ring-1 ring-white/5">
            No stream addon returned a source for this title. Install or enable a stream addon in the addon manager.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="rounded-lg bg-ink-850 px-4 py-6 text-center text-[13px] text-haze ring-1 ring-white/5">
            No source advertises {language} audio. Note that many releases list no language at all — switch back to
            “Any language” to see them.
          </p>
        ) : (
          <StreamList
            groups={visibleGroups}
            busyStreamId={busyStreamId}
            highlightStreamId={highlightSourceId}
            onPlay={(stream) => play(stream, playItem, selectedSubtitle)}
          />
        )}
      </section>
    </div>
  )
}
