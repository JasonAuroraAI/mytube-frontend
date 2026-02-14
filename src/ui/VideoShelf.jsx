import "./VideoShelf.css";
import VideoCard from "./VideoCard.jsx";
import { deleteVideo } from "../api.js";

export function VideoShelf({
  title,
  videos = [],
  user = null,
  onRequireLogin,
  startIndex = 0,
  lockAfter = null,
  onVideoDeleted, // optional callback
}) {
  const isLoggedIn = !!user?.id;

  async function handleDelete(v) {
    // if you want, you can add confirm here too (VideoCard already confirms)
    await deleteVideo(v.id);

    // let parent update state if it wants
    onVideoDeleted?.(v);

    // If parent doesn't manage state, at least no crash (but you probably want parent state update)
  }

  return (
    <section className="shelf">
      <div className="shelfHead">
        <h3 className="shelfTitle">{title}</h3>
      </div>

      <div className="shelfRow">
        {videos.map((video, idx) => {
          const globalIndex = startIndex + idx;
          const locked = !isLoggedIn && lockAfter != null && globalIndex >= lockAfter;

          return (
            <VideoCard
              key={video.id}
              video={video}
              user={user}                 // ✅ critical
              locked={locked}
              onRequireLogin={onRequireLogin}
              onDelete={handleDelete}     // ✅ critical (Delete button only renders if onDelete exists)
            />
          );
        })}
      </div>
    </section>
  );
}
