import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, Captions, Clock, Film, Loader2, MonitorPlay, Star, Tv,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  formatRuntime, metaApi, nextRequestId, playersApi, streamsApi, subtitlesApi, watchlistApi,
} from '../api/orion.js'
import { usePlayer } from '../components/PlayerProvider.jsx'
import StreamList from '../components/StreamList.jsx'
import Badge from '../components/Badge.jsx'

/** Looks up the episode number for the currently selected episode id. */
function episodeNumberFor(seasons, selectedSeason, episodeId) {
  if (!episodeId) return null
  const season = seasons.find((entry) => entry.season === selectedSeason)
  const video = season?.videos.find((item) => (item.id || '') === episodeId)
  return video?.episode ?? null
}

/**
 * Detail panel: backdrop, metadata and the resolved stream links for the item
 * (UI 3.1). For a series the stream and subtitle queries are both keyed to the
 * selected episode id.
 */
export default function Detail() {
  const { type, id } = useParams()
  const navigate = useNavigate()
  const { play, busyStreamId } = usePlayer()

  const decodedId = decodeURIComponent(id)

  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)

  const [selectedSeason, setSelectedSeason] = useState(null)
  const [episodeId, setEpisodeId] = useState(null)

  const [groups, setGroups] = useState([])
  const [streamErrors, setStreamErrors] = useState([])
  const [loadingStreams, setLoadingStreams] = useState(false)
  const [language, setLanguage] = useState('all')
  const [saved, setSaved] = useState(false)
  const [subtitleGroups, setSubtitleGroups] = useState([])
  const [loadingSubtitles, setLoadingSubtitles] = useState(false)
  const [subtitleId, setSubtitleId] = useState('')
  const streamRequest = useRef(null)

  const isSeries = type === 'series'
  const streamTargetId = isSeries ? episodeId : decodedId

  // ---- Metadata ----

  useEffect(() => {
    let cancelled = false
    setLoadingMeta(true)
    setMeta(null)
    setMetaError(null)
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

  useEffect(() => {
    if (seasons.length > 0 && selectedSeason === null) setSelectedSeason(seasons[0].season)
  }, [seasons, selectedSeason])

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
    })

    return () => {
      cancelled = true
    }
  }, [type, streamTargetId])

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

  const playItem = useMemo(
    () => ({
      type,
      id: decodedId,
      videoId: streamTargetId,
      name: meta?.name,
      poster: meta?.poster,
      season: isSeries ? Number(selectedSeason) : null,
      episode: isSeries ? episodeNumberFor(seasons, selectedSeason, episodeId) : null,
    }),
    [type, decodedId, streamTargetId, meta, isSeries, selectedSeason, seasons, episodeId],
  )

  // ---- Render ----

  if (loadingMeta) {
    return (
      <div className="page py-8">
        <div className="flex gap-7">
          <div className="skeleton aspect-[2/3] w-[210px] shrink-0" />
          <div className="flex-1 space-y-3 pt-2">
            <div className="skeleton h-7 w-1/2" />
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-4/5" />
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

  const genres = meta.genres || meta.genre || []
  const cast = meta.cast || []
  const director = meta.director || []
  const runtime = formatRuntime(meta.runtime)
  const currentSeason = seasons.find((entry) => entry.season === selectedSeason)

  return (
    <div className="pb-28">
      {/* Backdrop */}
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[420px] overflow-hidden">
          {meta.background && (
            <img
              src={meta.background}
              alt=""
              decoding="async"
              className="h-full w-full object-cover object-top opacity-60"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/90 to-ink-950/50" />
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

          <div className="flex flex-col gap-7 pt-10 sm:flex-row">
            <div className="w-[210px] shrink-0 overflow-hidden rounded-xl bg-ink-800 shadow-poster ring-1 ring-white/10">
              {meta.poster ? (
                <img src={meta.poster} alt={meta.name} decoding="async" className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[2/3] items-center justify-center text-ink-500">
                  {isSeries ? <Tv size={30} /> : <Film size={30} />}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">{meta.name}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {meta.releaseInfo && <Badge tone="muted">{meta.releaseInfo}</Badge>}
                {runtime && (
                  <Badge tone="muted">
                    <Clock size={10} />
                    {runtime}
                  </Badge>
                )}
                {meta.imdbRating && (
                  <Badge tone="amber">
                    <Star size={10} />
                    {meta.imdbRating}
                  </Badge>
                )}
                <Badge tone="accent">{meta.type || type}</Badge>
                {genres.slice(0, 5).map((genre) => (
                  <Badge key={genre}>{genre}</Badge>
                ))}
              </div>

              {meta.description && (
                <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-slate-300">{meta.description}</p>
              )}

              <button
                type="button"
                onClick={toggleWatchlist}
                className={`focus-ring mt-5 flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
                  saved
                    ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40 hover:bg-accent/30'
                    : 'bg-ink-800/80 text-slate-200 ring-1 ring-white/10 backdrop-blur hover:bg-ink-700'
                }`}
              >
                {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                {saved ? 'In watchlist' : 'Add to watchlist'}
              </button>

              <dl className="mt-4 space-y-1 text-[12px]">
                {director.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-ink-500">Director</dt>
                    <dd className="text-slate-300">{director.join(', ')}</dd>
                  </div>
                )}
                {cast.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-ink-500">Cast</dt>
                    <dd className="text-slate-300">{cast.slice(0, 6).join(', ')}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Episodes */}
      {isSeries && seasons.length > 0 && (
        <div className="page pt-9">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-[15px] font-semibold text-slate-100">Episodes</h2>
            {seasons.map((entry) => (
              <button
                key={entry.season}
                type="button"
                onClick={() => setSelectedSeason(entry.season)}
                className={`focus-ring rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                  entry.season === selectedSeason
                    ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40'
                    : 'bg-ink-850 text-haze hover:bg-ink-800 hover:text-slate-200'
                }`}
              >
                {entry.season === 0 ? 'Specials' : `Season ${entry.season}`}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(currentSeason?.videos || []).map((video) => {
              const videoId = video.id || `${decodedId}:${video.season}:${video.episode}`
              const active = videoId === episodeId

              return (
                <button
                  key={videoId}
                  type="button"
                  onClick={() => setEpisodeId(videoId)}
                  className={`focus-ring flex items-start gap-3 rounded-lg px-3 py-2.5 text-left ring-1 transition ${
                    active
                      ? 'bg-accent/10 ring-accent/40'
                      : 'bg-ink-850 ring-white/5 hover:bg-ink-800 hover:ring-white/10'
                  }`}
                >
                  <span className="mt-0.5 w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink-500">
                    {video.episode ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-200">
                      {video.title || video.name || `Episode ${video.episode}`}
                    </span>
                    {video.released && (
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        {new Date(video.released).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Streams */}
      <div className="page pt-9">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-semibold text-slate-100">Streams</h2>
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
                  onChange={(event) => setLanguage(event.target.value)}
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
        </div>

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
            onPlay={(stream) => play(stream, playItem, selectedSubtitle)}
          />
        )}
      </div>
    </div>
  )
}
