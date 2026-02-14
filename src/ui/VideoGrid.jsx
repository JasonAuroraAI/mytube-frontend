import VideoCard from "./VideoCard.jsx";

export default function VideoGrid({ videos, user, onRequireLogin }) {
  return (
    <div className="grid">
      {videos.map((video) => {
        console.log("SHELF", title, { startIndex, lockAfter, user, isLoggedIn: !!user?.id });

        const locked = video.visibility === "private" && !user;
        return (
          <VideoCard
            key={video.id}
            video={video}
            locked={locked}
            onRequireLogin={onRequireLogin}
          />
        );
      })}
    </div>
  );
}
