import NoteListView from "../components/NoteListView.jsx";

export default function Favorites() {
  return (
    <NoteListView
      title="Favorites"
      filterParams={{ favorite: "true" }}
      emptyMessage="Nothing favorited yet — star a note while reading it to save it here."
    />
  );
}
