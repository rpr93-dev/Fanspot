import { NewsFeed } from './NewsFeed'

/** Significance-ranked cross-league stories (homepage rail). */
export default function BiggestStories() {
  return <NewsFeed ranking="significance" limit={24} showScores />
}
