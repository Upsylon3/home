import NoteListView from "../components/NoteListView.jsx";

export default function Notes() {
  return (
    <NoteListView
      title="All Notes"
      filterParams={{}}
      emptyMessage="No notes yet — create one from the sidebar to get started."
    />
  );
}
