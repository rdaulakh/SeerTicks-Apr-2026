import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  BookOpen, 
  Plus, 
  Search, 
  Filter, 
  Star, 
  TrendingUp, 
  TrendingDown,
  Clock,
  Target,
  Brain,
  CheckCircle2,
  XCircle,
  Edit,
  Trash2,
  Calendar,
  Tag,
  BarChart3,
  Loader2
} from "lucide-react";
import { format } from "date-fns";

// Types
type MarketCondition = "trending" | "ranging" | "volatile" | "calm";
type EmotionBefore = "confident" | "neutral" | "anxious" | "fearful" | "greedy" | "frustrated";
type EmotionDuring = "confident" | "neutral" | "anxious" | "fearful" | "greedy" | "frustrated";
type EmotionAfter = "satisfied" | "neutral" | "disappointed" | "frustrated" | "relieved";

interface JournalEntry {
  id: number;
  userId: number;
  tradeId: number | null;
  title: string | null;
  setup: string | null;
  strategy: string | null;
  timeframe: string | null;
  marketCondition: MarketCondition | null;
  entryReason: string | null;
  confluenceFactors: string[] | null;
  exitReason: string | null;
  lessonsLearned: string | null;
  mistakes: string | null;
  improvements: string | null;
  emotionBefore: EmotionBefore | null;
  emotionDuring: EmotionDuring | null;
  emotionAfter: EmotionAfter | null;
  executionRating: number | null;
  followedPlan: boolean | null;
  screenshots: string[] | null;
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

// Emotion color mapping
const emotionColors: Record<string, string> = {
  confident: "bg-emerald-500/20 text-emerald-400",
  neutral: "bg-slate-500/20 text-slate-400",
  anxious: "bg-amber-500/20 text-amber-400",
  fearful: "bg-red-500/20 text-red-400",
  greedy: "bg-purple-500/20 text-purple-400",
  frustrated: "bg-orange-500/20 text-orange-400",
  satisfied: "bg-emerald-500/20 text-emerald-400",
  disappointed: "bg-red-500/20 text-red-400",
  relieved: "bg-blue-500/20 text-blue-400",
};

// Market condition color mapping
const marketConditionColors: Record<string, string> = {
  trending: "bg-emerald-500/20 text-emerald-400",
  ranging: "bg-amber-500/20 text-amber-400",
  volatile: "bg-red-500/20 text-red-400",
  calm: "bg-blue-500/20 text-blue-400",
};

// Star rating component
function StarRating({ rating, onChange, readonly = false }: { rating: number | null; onChange?: (rating: number) => void; readonly?: boolean }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
        >
          <Star
            className={`h-5 w-5 ${
              rating && star <= rating
                ? "fill-amber-400 text-amber-400"
                : "text-slate-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// Journal entry form
function JournalEntryForm({ 
  entry, 
  onSubmit, 
  onCancel,
  isSubmitting 
}: { 
  entry?: JournalEntry; 
  onSubmit: (data: Partial<JournalEntry>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    title: entry?.title || "",
    setup: entry?.setup || "",
    strategy: entry?.strategy || "",
    timeframe: entry?.timeframe || "",
    marketCondition: entry?.marketCondition || "",
    entryReason: entry?.entryReason || "",
    confluenceFactors: entry?.confluenceFactors?.join(", ") || "",
    exitReason: entry?.exitReason || "",
    lessonsLearned: entry?.lessonsLearned || "",
    mistakes: entry?.mistakes || "",
    improvements: entry?.improvements || "",
    emotionBefore: entry?.emotionBefore || "",
    emotionDuring: entry?.emotionDuring || "",
    emotionAfter: entry?.emotionAfter || "",
    executionRating: entry?.executionRating || 0,
    followedPlan: entry?.followedPlan ?? null,
    tags: entry?.tags?.join(", ") || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: formData.title || null,
      setup: formData.setup || null,
      strategy: formData.strategy || null,
      timeframe: formData.timeframe || null,
      marketCondition: (formData.marketCondition as MarketCondition) || null,
      entryReason: formData.entryReason || null,
      confluenceFactors: formData.confluenceFactors ? formData.confluenceFactors.split(",").map(s => s.trim()).filter(Boolean) : null,
      exitReason: formData.exitReason || null,
      lessonsLearned: formData.lessonsLearned || null,
      mistakes: formData.mistakes || null,
      improvements: formData.improvements || null,
      emotionBefore: (formData.emotionBefore as EmotionBefore) || null,
      emotionDuring: (formData.emotionDuring as EmotionDuring) || null,
      emotionAfter: (formData.emotionAfter as EmotionAfter) || null,
      executionRating: formData.executionRating || null,
      followedPlan: formData.followedPlan,
      tags: formData.tags ? formData.tags.split(",").map(s => s.trim()).filter(Boolean) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="emotions">Emotions</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-4 mt-4">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g., BTC Long - Breakout Trade"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="strategy">Strategy</Label>
                <Input
                  id="strategy"
                  placeholder="e.g., Breakout, Scalping"
                  value={formData.strategy}
                  onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeframe">Timeframe</Label>
                <Select
                  value={formData.timeframe}
                  onValueChange={(value) => setFormData({ ...formData, timeframe: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1 Minute</SelectItem>
                    <SelectItem value="5m">5 Minutes</SelectItem>
                    <SelectItem value="15m">15 Minutes</SelectItem>
                    <SelectItem value="1h">1 Hour</SelectItem>
                    <SelectItem value="4h">4 Hours</SelectItem>
                    <SelectItem value="1d">Daily</SelectItem>
                    <SelectItem value="1w">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="marketCondition">Market Condition</Label>
              <Select
                value={formData.marketCondition}
                onValueChange={(value) => setFormData({ ...formData, marketCondition: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select market condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trending">Trending</SelectItem>
                  <SelectItem value="ranging">Ranging</SelectItem>
                  <SelectItem value="volatile">Volatile</SelectItem>
                  <SelectItem value="calm">Calm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="setup">Trade Setup</Label>
              <Textarea
                id="setup"
                placeholder="Describe your trade setup..."
                value={formData.setup}
                onChange={(e) => setFormData({ ...formData, setup: e.target.value })}
                rows={3}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="entryReason">Entry Reason</Label>
            <Textarea
              id="entryReason"
              placeholder="Why did you enter this trade?"
              value={formData.entryReason}
              onChange={(e) => setFormData({ ...formData, entryReason: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confluenceFactors">Confluence Factors (comma-separated)</Label>
            <Input
              id="confluenceFactors"
              placeholder="e.g., RSI oversold, Support level, Volume spike"
              value={formData.confluenceFactors}
              onChange={(e) => setFormData({ ...formData, confluenceFactors: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exitReason">Exit Reason</Label>
            <Textarea
              id="exitReason"
              placeholder="Why did you exit this trade?"
              value={formData.exitReason}
              onChange={(e) => setFormData({ ...formData, exitReason: e.target.value })}
              rows={3}
            />
          </div>
        </TabsContent>

        <TabsContent value="emotions" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Before Trade</Label>
              <Select
                value={formData.emotionBefore}
                onValueChange={(value) => setFormData({ ...formData, emotionBefore: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select emotion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confident">Confident</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="anxious">Anxious</SelectItem>
                  <SelectItem value="fearful">Fearful</SelectItem>
                  <SelectItem value="greedy">Greedy</SelectItem>
                  <SelectItem value="frustrated">Frustrated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>During Trade</Label>
              <Select
                value={formData.emotionDuring}
                onValueChange={(value) => setFormData({ ...formData, emotionDuring: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select emotion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confident">Confident</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="anxious">Anxious</SelectItem>
                  <SelectItem value="fearful">Fearful</SelectItem>
                  <SelectItem value="greedy">Greedy</SelectItem>
                  <SelectItem value="frustrated">Frustrated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>After Trade</Label>
              <Select
                value={formData.emotionAfter}
                onValueChange={(value) => setFormData({ ...formData, emotionAfter: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select emotion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="satisfied">Satisfied</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="disappointed">Disappointed</SelectItem>
                  <SelectItem value="frustrated">Frustrated</SelectItem>
                  <SelectItem value="relieved">Relieved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="lessonsLearned">Lessons Learned</Label>
            <Textarea
              id="lessonsLearned"
              placeholder="What did you learn from this trade?"
              value={formData.lessonsLearned}
              onChange={(e) => setFormData({ ...formData, lessonsLearned: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mistakes">Mistakes Made</Label>
            <Textarea
              id="mistakes"
              placeholder="What mistakes did you make?"
              value={formData.mistakes}
              onChange={(e) => setFormData({ ...formData, mistakes: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="improvements">Areas for Improvement</Label>
            <Textarea
              id="improvements"
              placeholder="What can you improve?"
              value={formData.improvements}
              onChange={(e) => setFormData({ ...formData, improvements: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Execution Rating</Label>
              <StarRating
                rating={formData.executionRating}
                onChange={(rating) => setFormData({ ...formData, executionRating: rating })}
              />
            </div>

            <div className="space-y-2">
              <Label>Followed Trading Plan?</Label>
              <div className="flex gap-4 mt-2">
                <Button
                  type="button"
                  variant={formData.followedPlan === true ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormData({ ...formData, followedPlan: true })}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={formData.followedPlan === false ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setFormData({ ...formData, followedPlan: false })}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  No
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              placeholder="e.g., btc, breakout, profitable"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            />
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {entry ? "Update Entry" : "Create Entry"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Journal entry card
function JournalEntryCard({ 
  entry, 
  onEdit, 
  onDelete,
  onView 
}: { 
  entry: JournalEntry; 
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
}) {
  return (
    <Card className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors cursor-pointer" onClick={onView}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg text-slate-100 line-clamp-1">
              {entry.title || "Untitled Entry"}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </CardDescription>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {entry.strategy && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
              <Target className="h-3 w-3 mr-1" />
              {entry.strategy}
            </Badge>
          )}
          {entry.timeframe && (
            <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30">
              <Clock className="h-3 w-3 mr-1" />
              {entry.timeframe}
            </Badge>
          )}
          {entry.marketCondition && (
            <Badge className={marketConditionColors[entry.marketCondition]}>
              {entry.marketCondition}
            </Badge>
          )}
        </div>

        {entry.setup && (
          <p className="text-sm text-slate-400 line-clamp-2">{entry.setup}</p>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-700">
          <div className="flex items-center gap-4">
            {entry.executionRating && (
              <StarRating rating={entry.executionRating} readonly />
            )}
            {entry.followedPlan !== null && (
              <div className="flex items-center gap-1">
                {entry.followedPlan ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className="text-xs text-slate-500">Plan</span>
              </div>
            )}
          </div>

          {entry.tags && entry.tags.length > 0 && (
            <div className="flex gap-1">
              {(entry.tags as string[]).slice(0, 3).map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {(entry.tags as string[]).length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{(entry.tags as string[]).length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Entry detail view
function EntryDetailView({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle className="text-xl">{entry.title || "Untitled Entry"}</DialogTitle>
        <DialogDescription>
          Created on {format(new Date(entry.createdAt), "MMMM d, yyyy 'at' h:mm a")}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-[60vh] pr-4">
        <div className="space-y-6">
          {/* Setup Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Target className="h-4 w-4" />
              Trade Setup
            </h3>
            <div className="flex flex-wrap gap-2">
              {entry.strategy && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                  Strategy: {entry.strategy}
                </Badge>
              )}
              {entry.timeframe && (
                <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30">
                  Timeframe: {entry.timeframe}
                </Badge>
              )}
              {entry.marketCondition && (
                <Badge className={marketConditionColors[entry.marketCondition]}>
                  {entry.marketCondition}
                </Badge>
              )}
            </div>
            {entry.setup && (
              <p className="text-sm text-slate-400 bg-slate-800/50 p-3 rounded-lg">{entry.setup}</p>
            )}
          </div>

          <Separator />

          {/* Analysis Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Analysis
            </h3>
            {entry.entryReason && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Entry Reason</p>
                <p className="text-sm text-slate-400">{entry.entryReason}</p>
              </div>
            )}
            {entry.confluenceFactors && (entry.confluenceFactors as string[]).length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Confluence Factors</p>
                <div className="flex flex-wrap gap-1">
                  {(entry.confluenceFactors as string[]).map((factor, i) => (
                    <Badge key={i} variant="secondary">{factor}</Badge>
                  ))}
                </div>
              </div>
            )}
            {entry.exitReason && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Exit Reason</p>
                <p className="text-sm text-slate-400">{entry.exitReason}</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Emotions Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">Emotional State</h3>
            <div className="grid grid-cols-3 gap-4">
              {entry.emotionBefore && (
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">Before</p>
                  <Badge className={emotionColors[entry.emotionBefore]}>{entry.emotionBefore}</Badge>
                </div>
              )}
              {entry.emotionDuring && (
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">During</p>
                  <Badge className={emotionColors[entry.emotionDuring]}>{entry.emotionDuring}</Badge>
                </div>
              )}
              {entry.emotionAfter && (
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">After</p>
                  <Badge className={emotionColors[entry.emotionAfter]}>{entry.emotionAfter}</Badge>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Review Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Review
            </h3>
            {entry.lessonsLearned && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Lessons Learned</p>
                <p className="text-sm text-slate-400 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">{entry.lessonsLearned}</p>
              </div>
            )}
            {entry.mistakes && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Mistakes</p>
                <p className="text-sm text-slate-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20">{entry.mistakes}</p>
              </div>
            )}
            {entry.improvements && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Improvements</p>
                <p className="text-sm text-slate-400 bg-blue-500/10 p-3 rounded-lg border border-blue-500/20">{entry.improvements}</p>
              </div>
            )}

            <div className="flex items-center gap-6 pt-2">
              {entry.executionRating && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Execution Rating</p>
                  <StarRating rating={entry.executionRating} readonly />
                </div>
              )}
              {entry.followedPlan !== null && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Followed Plan</p>
                  <div className="flex items-center gap-1">
                    {entry.followedPlan ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        <span className="text-emerald-400">Yes</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-5 w-5 text-red-400" />
                        <span className="text-red-400">No</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          {entry.tags && (entry.tags as string[]).length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Tags
                </h3>
                <div className="flex flex-wrap gap-1">
                  {(entry.tags as string[]).map((tag, i) => (
                    <Badge key={i} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// Main component
export default function TradeJournal() {
  const { user, loading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Queries
  const { data: entries, isLoading: entriesLoading, refetch } = trpc.tradeJournal.list.useQuery(
    { limit: 100, offset: 0 },
    { enabled: !!user }
  );
  const { data: stats } = trpc.tradeJournal.getStats.useQuery(undefined, { enabled: !!user });
  const { data: strategies } = trpc.tradeJournal.getStrategies.useQuery(undefined, { enabled: !!user });

  // Mutations
  const createMutation = trpc.tradeJournal.create.useMutation({
    onSuccess: () => {
      toast.success("Journal entry created");
      setIsCreateDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to create entry: ${error.message}`);
    },
  });

  const updateMutation = trpc.tradeJournal.update.useMutation({
    onSuccess: () => {
      toast.success("Journal entry updated");
      setEditingEntry(null);
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to update entry: ${error.message}`);
    },
  });

  const deleteMutation = trpc.tradeJournal.delete.useMutation({
    onSuccess: () => {
      toast.success("Journal entry deleted");
      setDeleteConfirmId(null);
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to delete entry: ${error.message}`);
    },
  });

  // Filter entries
  const filteredEntries = entries?.filter((entry) => {
    const matchesSearch = !searchQuery || 
      entry.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.setup?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.strategy?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStrategy = selectedStrategy === "all" || entry.strategy === selectedStrategy;
    
    return matchesSearch && matchesStrategy;
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-purple-400" />
              Trade Journal
            </h1>
            <p className="text-slate-400 mt-1">
              Document your trades, track emotions, and improve your strategy
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-purple-600 hover:bg-purple-700">
                <Plus className="h-4 w-4 mr-2" />
                New Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Journal Entry</DialogTitle>
                <DialogDescription>
                  Document your trade analysis, emotions, and lessons learned
                </DialogDescription>
              </DialogHeader>
              <JournalEntryForm
                onSubmit={(data) => createMutation.mutate(data as any)}
                onCancel={() => setIsCreateDialogOpen(false)}
                isSubmitting={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Total Entries</p>
                  <p className="text-2xl font-bold text-slate-100">{stats?.totalEntries || 0}</p>
                </div>
                <BookOpen className="h-8 w-8 text-purple-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Plan Adherence</p>
                  <p className="text-2xl font-bold text-emerald-400">
                    {stats?.followedPlanRate 
                      ? Math.round(stats.followedPlanRate * 100) 
                      : 0}%
                  </p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Avg Rating</p>
                  <p className="text-2xl font-bold text-amber-400">
                    {stats?.avgExecutionRating 
                      ? Number(stats.avgExecutionRating).toFixed(1) 
                      : "—"}
                  </p>
                </div>
                <Star className="h-8 w-8 text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Strategies</p>
                  <p className="text-2xl font-bold text-blue-400">{strategies?.length || 0}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-800/50 border-slate-700"
            />
          </div>
          <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
            <SelectTrigger className="w-48 bg-slate-800/50 border-slate-700">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by strategy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Strategies</SelectItem>
              {strategies?.map((strategy) => (
                <SelectItem key={strategy} value={strategy}>{strategy}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Entries Grid */}
        {entriesLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filteredEntries && filteredEntries.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEntries.map((entry) => (
              <JournalEntryCard
                key={entry.id}
                entry={entry as JournalEntry}
                onEdit={() => setEditingEntry(entry as JournalEntry)}
                onDelete={() => setDeleteConfirmId(entry.id)}
                onView={() => setViewingEntry(entry as JournalEntry)}
              />
            ))}
          </div>
        ) : (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="h-12 w-12 text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-300">No journal entries yet</h3>
              <p className="text-slate-500 mt-1">Start documenting your trades to improve your strategy</p>
              <Button 
                className="mt-4 bg-purple-600 hover:bg-purple-700"
                onClick={() => setIsCreateDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Entry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Edit Dialog */}
        <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Journal Entry</DialogTitle>
              <DialogDescription>
                Update your trade analysis and notes
              </DialogDescription>
            </DialogHeader>
            {editingEntry && (
              <JournalEntryForm
                entry={editingEntry}
                onSubmit={(data) => updateMutation.mutate({ id: editingEntry.id, data: data as any })}
                onCancel={() => setEditingEntry(null)}
                isSubmitting={updateMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* View Dialog */}
        <Dialog open={!!viewingEntry} onOpenChange={(open) => !open && setViewingEntry(null)}>
          {viewingEntry && (
            <EntryDetailView 
              entry={viewingEntry} 
              onClose={() => setViewingEntry(null)} 
            />
          )}
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Journal Entry</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this journal entry? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteConfirmId && deleteMutation.mutate({ id: deleteConfirmId })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
