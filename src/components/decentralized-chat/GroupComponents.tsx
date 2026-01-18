/**
 * Group Chat Components
 * World-class decentralized group management
 */

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Users,
  UserPlus,
  UserMinus,
  UserCog,
  Settings,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Crown,
  Star,
  Lock,
  Globe,
  Link,
  Copy,
  Check,
  X,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Bell,
  BellOff,
  MessageSquare,
  Video,
  Calendar,
  Image as ImageIcon,
  Upload,
  Hash,
  AtSign,
  Loader2,
  AlertCircle,
  CheckCircle,
  Mail,
  ExternalLink,
  Eye,
  EyeOff,
  Ban,
  Undo,
  RefreshCw,
  Share2,
} from "lucide-react";
import type {
  ChatGroup,
  GroupMember,
  GroupRole,
  GroupPermissions,
  GroupSettings,
  GroupInvite,
  JoinRequest,
  BannedUser,
  GroupTopic,
  ChatIdentity,
} from "@/types/decentralized_chat_types";

// ============================================================================
// Create Group Dialog
// ============================================================================

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupCreated?: (group: ChatGroup) => void;
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  onGroupCreated,
}: CreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "settings" | "invite">("details");

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create group via IPC
      // const result = await createGroup({ ... });
      // onGroupCreated?.(result.group);
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setIsPrivate(false);
    setRequireApproval(false);
    setStep("details");
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) resetForm();
      onOpenChange(o);
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Create Group
          </DialogTitle>
          <DialogDescription>
            Create a new group for decentralized communication.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 mb-4">
          <div className={cn(
            "flex items-center gap-2 text-sm",
            step === "details" ? "text-primary" : "text-muted-foreground"
          )}>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs",
              step === "details" ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>1</div>
            Details
          </div>
          <div className={cn(
            "flex items-center gap-2 text-sm",
            step === "settings" ? "text-primary" : "text-muted-foreground"
          )}>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs",
              step === "settings" ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>2</div>
            Settings
          </div>
          <div className={cn(
            "flex items-center gap-2 text-sm",
            step === "invite" ? "text-primary" : "text-muted-foreground"
          )}>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs",
              step === "invite" ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>3</div>
            Invite
          </div>
        </div>

        {step === "details" && (
          <div className="space-y-4">
            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  <AvatarFallback className="text-2xl">
                    {name ? name.slice(0, 2).toUpperCase() : "GP"}
                  </AvatarFallback>
                </Avatar>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full"
                >
                  <Upload className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex-1">
                <Label>Group Avatar</Label>
                <p className="text-xs text-muted-foreground">
                  Upload an image for your group
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Group Name *</Label>
              <Input
                placeholder="My Awesome Group"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground text-right">
                {name.length}/50
              </p>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="What's this group about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length}/500
              </p>
            </div>
          </div>
        )}

        {step === "settings" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  {isPrivate ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                  Private Group
                </Label>
                <p className="text-xs text-muted-foreground">
                  {isPrivate 
                    ? "Only invited members can join"
                    : "Anyone can find and join this group"
                  }
                </p>
              </div>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Require Approval
                </Label>
                <p className="text-xs text-muted-foreground">
                  Admins must approve new members
                </p>
              </div>
              <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Member Permissions</Label>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Send messages</span>
                <Switch defaultChecked />
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Send media</span>
                <Switch defaultChecked />
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Start video calls</span>
                <Switch defaultChecked />
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Add new members</span>
                <Switch />
              </div>
            </div>
          </div>
        )}

        {step === "invite" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Invite Link</Label>
              <div className="flex gap-2">
                <Input value="group.link/abc123xyz" readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link to invite people to your group
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Add Members</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name or wallet address" className="pl-9" />
              </div>
            </div>

            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Search for people to add</p>
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-500 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <DialogFooter>
          {step !== "details" && (
            <Button
              variant="outline"
              onClick={() => setStep(step === "invite" ? "settings" : "details")}
            >
              Back
            </Button>
          )}
          
          {step === "invite" ? (
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Group
            </Button>
          ) : (
            <Button
              onClick={() => setStep(step === "details" ? "settings" : "invite")}
              disabled={step === "details" && !name.trim()}
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Group Settings Dialog
// ============================================================================

interface GroupSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ChatGroup;
  currentUserRole: GroupRole;
  onGroupUpdated?: (group: ChatGroup) => void;
  onGroupDeleted?: () => void;
}

export function GroupSettingsDialog({
  open,
  onOpenChange,
  group,
  currentUserRole,
  onGroupUpdated,
  onGroupDeleted,
}: GroupSettingsDialogProps) {
  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save via IPC
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Group Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex-1">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
            <TabsTrigger value="danger">Danger</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[400px] mt-4">
            <TabsContent value="general" className="space-y-4 pr-4">
              {/* Group avatar */}
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={group.avatar} />
                  <AvatarFallback className="text-2xl">
                    {group.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {isAdmin && (
                  <Button variant="outline">
                    <Upload className="h-4 w-4 mr-2" />
                    Change Avatar
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>Group Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={!isAdmin}
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">Group Info</h4>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <p>{new Date(group.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Members:</span>
                    <p>{group.memberCount}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Privacy:</span>
                    <p className="flex items-center gap-1">
                      {group.isPrivate ? (
                        <>
                          <Lock className="h-3 w-3" /> Private
                        </>
                      ) : (
                        <>
                          <Globe className="h-3 w-3" /> Public
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Messages:</span>
                    <p>1,234</p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="members" className="space-y-4 pr-4">
              <MemberManagementPanel
                group={group}
                currentUserRole={currentUserRole}
              />
            </TabsContent>

            <TabsContent value="permissions" className="space-y-4 pr-4">
              <PermissionsPanel
                group={group}
                isAdmin={isAdmin}
              />
            </TabsContent>

            <TabsContent value="danger" className="space-y-4 pr-4">
              <DangerZonePanel
                group={group}
                isOwner={isOwner}
                onLeave={() => onOpenChange(false)}
                onDelete={onGroupDeleted}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isAdmin && (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Member Management Panel
// ============================================================================

interface MemberManagementPanelProps {
  group: ChatGroup;
  currentUserRole: GroupRole;
}

function MemberManagementPanel({ group, currentUserRole }: MemberManagementPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "admins" | "members">("all");
  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

  // Mock members for demonstration
  const members: GroupMember[] = group.members || [];

  const filteredMembers = members.filter(member => {
    const matchesSearch = 
      member.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.walletAddress.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filter === "all" ||
      (filter === "admins" && (member.role === "admin" || member.role === "owner")) ||
      (filter === "members" && member.role === "member");
    
    return matchesSearch && matchesFilter;
  });

  const getRoleBadge = (role: GroupRole) => {
    switch (role) {
      case "owner":
        return <Badge className="bg-amber-500"><Crown className="h-3 w-3 mr-1" />Owner</Badge>;
      case "admin":
        return <Badge variant="secondary"><ShieldCheck className="h-3 w-3 mr-1" />Admin</Badge>;
      case "moderator":
        return <Badge variant="outline"><Shield className="h-3 w-3 mr-1" />Mod</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="admins">Admins</SelectItem>
            <SelectItem value="members">Members</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invite button */}
      {isAdmin && (
        <Button className="w-full">
          <UserPlus className="h-4 w-4 mr-2" />
          Invite Members
        </Button>
      )}

      {/* Pending requests */}
      {isAdmin && group.settings?.requireApproval && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Pending Requests
              <Badge>3</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Mock pending requests */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>US</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">User123</p>
                  <p className="text-xs text-muted-foreground">2 hours ago</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600">
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members list */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm text-muted-foreground">
          {filteredMembers.length} members
        </h4>
        
        {filteredMembers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No members found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredMembers.map((member) => (
              <div
                key={member.walletAddress}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage src={member.avatar} />
                  <AvatarFallback>
                    {member.displayName?.slice(0, 2).toUpperCase() ||
                     member.walletAddress.slice(2, 4).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">
                      {member.displayName || member.walletAddress.slice(0, 10) + "..."}
                    </p>
                    {getRoleBadge(member.role)}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {member.walletAddress}
                  </p>
                </div>

                {isAdmin && member.role !== "owner" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Member Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {member.role === "member" && (
                        <DropdownMenuItem>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          Make Admin
                        </DropdownMenuItem>
                      )}
                      {member.role === "admin" && currentUserRole === "owner" && (
                        <DropdownMenuItem>
                          <UserMinus className="h-4 w-4 mr-2" />
                          Remove Admin
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>
                        <BellOff className="h-4 w-4 mr-2" />
                        Mute
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600">
                        <Ban className="h-4 w-4 mr-2" />
                        Ban & Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Permissions Panel
// ============================================================================

interface PermissionsPanelProps {
  group: ChatGroup;
  isAdmin: boolean;
}

function PermissionsPanel({ group, isAdmin }: PermissionsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h4 className="font-medium">Member Permissions</h4>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Send Messages</Label>
              <p className="text-xs text-muted-foreground">
                Members can send text messages
              </p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Send Media</Label>
              <p className="text-xs text-muted-foreground">
                Members can send images, videos, and files
              </p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Send Links</Label>
              <p className="text-xs text-muted-foreground">
                Members can share URLs
              </p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Start Video Calls</Label>
              <p className="text-xs text-muted-foreground">
                Members can initiate group video calls
              </p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Add Members</Label>
              <p className="text-xs text-muted-foreground">
                Members can invite new people
              </p>
            </div>
            <Switch disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Create Polls</Label>
              <p className="text-xs text-muted-foreground">
                Members can create polls
              </p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Pin Messages</Label>
              <p className="text-xs text-muted-foreground">
                Members can pin messages (usually admin only)
              </p>
            </div>
            <Switch disabled={!isAdmin} />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h4 className="font-medium">Group Visibility</h4>
        
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-2">
              {group.isPrivate ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              Private Group
            </Label>
            <p className="text-xs text-muted-foreground">
              {group.isPrivate 
                ? "Only invited members can join"
                : "Anyone can find and join this group"
              }
            </p>
          </div>
          <Switch checked={group.isPrivate} disabled={!isAdmin} />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Require Approval</Label>
            <p className="text-xs text-muted-foreground">
              Admins must approve join requests
            </p>
          </div>
          <Switch checked={group.settings?.requireApproval} disabled={!isAdmin} />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h4 className="font-medium">Message Controls</h4>

        <div className="space-y-2">
          <Label>Slow Mode</Label>
          <Select defaultValue="off" disabled={!isAdmin}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="5">5 seconds</SelectItem>
              <SelectItem value="10">10 seconds</SelectItem>
              <SelectItem value="30">30 seconds</SelectItem>
              <SelectItem value="60">1 minute</SelectItem>
              <SelectItem value="300">5 minutes</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Limit how often members can send messages
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Danger Zone Panel
// ============================================================================

interface DangerZonePanelProps {
  group: ChatGroup;
  isOwner: boolean;
  onLeave: () => void;
  onDelete?: () => void;
}

function DangerZonePanel({ group, isOwner, onLeave, onDelete }: DangerZonePanelProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
        <h4 className="font-medium flex items-center gap-2 text-yellow-600">
          <AlertCircle className="h-4 w-4" />
          Warning Zone
        </h4>
        <p className="text-sm text-muted-foreground mt-1">
          These actions cannot be easily undone. Please proceed with caution.
        </p>
      </div>

      {/* Leave Group */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Leave Group</CardTitle>
          <CardDescription>
            Remove yourself from this group. You can rejoin if the group is public.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-yellow-600" disabled={isOwner}>
                <UserMinus className="h-4 w-4 mr-2" />
                Leave Group
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this group?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will no longer be able to send messages or see new content in this group.
                  {group.isPrivate && " Since this is a private group, you'll need an invite to rejoin."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    setIsLeaving(true);
                    try {
                      // Leave via IPC
                      onLeave();
                    } finally {
                      setIsLeaving(false);
                    }
                  }}
                >
                  {isLeaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Leave
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {isOwner && (
            <p className="text-xs text-muted-foreground mt-2">
              As the owner, you must transfer ownership before leaving.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Transfer Ownership (Owner only) */}
      {isOwner && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Transfer Ownership</CardTitle>
            <CardDescription>
              Transfer group ownership to another admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline">
              <Crown className="h-4 w-4 mr-2" />
              Transfer Ownership
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete Group (Owner only) */}
      {isOwner && (
        <Card className="border-red-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600">Delete Group</CardTitle>
            <CardDescription>
              Permanently delete this group and all its messages. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Group
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action is permanent and cannot be undone. All messages, media, and member data will be permanently deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={async () => {
                      setIsDeleting(true);
                      try {
                        // Delete via IPC
                        onDelete?.();
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Delete Forever
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Group Card Component (for group list)
// ============================================================================

interface GroupCardProps {
  group: ChatGroup;
  onClick?: () => void;
  isSelected?: boolean;
}

export function GroupCard({ group, onClick, isSelected }: GroupCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:bg-muted/50",
        isSelected && "ring-2 ring-primary bg-muted/50"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={group.avatar} />
            <AvatarFallback className="text-lg">
              {group.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{group.name}</h3>
              {group.isPrivate && <Lock className="h-3 w-3 text-muted-foreground" />}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {group.description || `${group.memberCount} members`}
            </p>
          </div>

          <div className="text-right">
            <Badge variant="secondary">{group.memberCount}</Badge>
            {group.unreadCount && group.unreadCount > 0 && (
              <Badge className="ml-1">{group.unreadCount}</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Group Invite Dialog
// ============================================================================

interface GroupInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ChatGroup;
}

export function GroupInviteDialog({ open, onOpenChange, group }: GroupInviteDialogProps) {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const copyLink = () => {
    navigator.clipboard.writeText(group.inviteLink || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite to {group.name}
          </DialogTitle>
          <DialogDescription>
            Invite people to join your group.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link">Invite Link</TabsTrigger>
            <TabsTrigger value="direct">Direct Invite</TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4">
            <div className="space-y-2">
              <Label>Share this link</Label>
              <div className="flex gap-2">
                <Input
                  value={group.inviteLink || "Generating..."}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reset Link
              </Button>
              <Button className="flex-1">
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="direct" className="space-y-4">
            <div className="space-y-2">
              <Label>Search for people</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Name or wallet address"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Search for people to invite</p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateGroupDialog;
