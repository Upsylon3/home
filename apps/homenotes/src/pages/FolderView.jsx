import { useParams, useOutletContext } from "react-router-dom";
import NoteListView from "../components/NoteListView.jsx";

export default function FolderView() {
  const { folderId } = useParams();
  const { folders } = useOutletContext();
  const folder = folders.find((f) => String(f.id) === folderId);

  return (
    <NoteListView
      key={folderId}
      title={folder ? folder.name : "Folder"}
      filterParams={{ folderId }}
      emptyMessage="No notes in this folder yet."
    />
  );
}
