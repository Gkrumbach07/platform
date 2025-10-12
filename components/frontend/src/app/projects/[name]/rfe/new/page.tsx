"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { ArrowLeft, Loader2, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CreateRFEWorkflowRequest } from "@/types/agentic-session";
import { getApiUrl } from "@/lib/config";

const repoSchema = z.object({
  url: z.string().url("Please enter a valid repository URL"),
  branch: z.string().min(1, "Branch is required").default("main"),
});

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters long"),
  description: z.string().min(20, "Description must be at least 20 characters long"),
  workspacePath: z.string().optional(),
  featureBranch: z.string()
    .min(1, "Feature branch name is required")
    .trim(),
  umbrellaRepo: repoSchema,
  supportingRepos: z.array(repoSchema).optional().default([]),
});

type FormValues = z.input<typeof formSchema>;

export default function ProjectNewRFEWorkflowPage() {
  const router = useRouter();
  const params = useParams();
  const project = params?.name as string;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatingBranch, setValidatingBranch] = useState(false);
  const [branchValidationError, setBranchValidationError] = useState<string | null>(null);
  const [branchValidated, setBranchValidated] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      title: "",
      description: "",
      workspacePath: "",
      featureBranch: "",
      umbrellaRepo: { url: "", branch: "main" },
      supportingRepos: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "supportingRepos",
  });

  const validateBranchAvailability = async (branchName: string, repos: Array<{ url: string }>) => {
    if (!branchName || repos.length === 0) {
      setBranchValidated(false);
      return false;
    }
    
    setValidatingBranch(true);
    setBranchValidationError(null);
    setBranchValidated(false);

    try {
      const repoUrls = repos.map(r => r.url.trim()).filter(u => u !== "");
      if (repoUrls.length === 0) {
        setBranchValidated(false);
        return false;
      }

      const url = `${getApiUrl()}/projects/${encodeURIComponent(project)}/rfe-workflows/validate-branch`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName, repoUrls }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setBranchValidationError(errorData.error || "Branch validation failed");
        setBranchValidated(false);
        return false;
      }

      const result = await response.json();
      if (!result.available) {
        setBranchValidationError(result.message || "Branch already exists");
        setBranchValidated(false);
        return false;
      }
      
      setBranchValidated(true);
      form.clearErrors("featureBranch"); // Clear any previous validation errors on success
      return true;
    } catch (err) {
      setBranchValidationError(err instanceof Error ? err.message : "Failed to validate branch");
      setBranchValidated(false);
      return false;
    } finally {
      setValidatingBranch(false);
    }
  };

  // Trigger validation when repos or branch name changes
  const triggerBranchValidation = () => {
    const branchName = form.getValues("featureBranch");
    const umbrellaUrl = form.getValues("umbrellaRepo.url");
    const supportingRepos = form.getValues("supportingRepos") || [];
    
    if (branchName && umbrellaUrl) {
      const allRepos = [{ url: umbrellaUrl }, ...supportingRepos];
      validateBranchAvailability(branchName, allRepos);
    } else {
      setBranchValidated(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Always validate branch before submitting
      const allRepos = [values.umbrellaRepo, ...(values.supportingRepos || [])];
      const isValid = await validateBranchAvailability(values.featureBranch, allRepos);
      
      if (!isValid) {
        // Set validation error on the form field
        form.setError("featureBranch", {
          type: "manual",
          message: branchValidationError || "Branch name is not available on all repositories",
        });
        setIsSubmitting(false);
        return;
      }

      const request: CreateRFEWorkflowRequest = {
        title: values.title,
        description: values.description,
        workspacePath: values.workspacePath || undefined,
        featureBranch: values.featureBranch.trim(),
        umbrellaRepo: {
          url: values.umbrellaRepo.url.trim(),
          branch: values.umbrellaRepo.branch?.trim() || "main",
        },
        supportingRepos: (values.supportingRepos || [])
          .filter(r => r && r.url && r.url.trim() !== "")
          .map(r => ({ url: r.url.trim(), branch: r.branch?.trim() || "main" })),
      };

      const url = `${getApiUrl()}/projects/${encodeURIComponent(project)}/rfe-workflows`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(message);
      }

      const result = await response.json();
      router.push(`/projects/${encodeURIComponent(project)}/rfe/${encodeURIComponent(result.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create RFE workspace");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href={`/projects/${encodeURIComponent(project)}/rfe`}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to RFE Workspaces</Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Create RFE Workspace</h1>
            <p className="text-muted-foreground">Set up a new Request for Enhancement workflow with AI agents</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(onSubmit)(e); }} className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" />RFE Details</CardTitle>
                <CardDescription>Provide basic information about the feature or enhancement</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFE Title</FormLabel>
                    <FormControl><Input placeholder="e.g., User Authentication System" {...field} /></FormControl>
                    <FormDescription>A concise title that describes the feature or enhancement</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea placeholder="Describe the feature requirements, goals, and context..." rows={4} {...field} /></FormControl>
                    <FormDescription>Detailed description of what needs to be built and why</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" />Feature Branch</CardTitle>
                <CardDescription>
                  The new branch that will be created across all repositories for this RFE work. 
                  This branch will be created from the source branches specified below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="featureBranch" render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Feature Branch Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="my-feature-name" 
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setBranchValidated(false); // Mark as unvalidated when changed
                          form.clearErrors("featureBranch"); // Clear any previous validation errors
                        }}
                        onBlur={() => {
                          field.onBlur();
                          triggerBranchValidation();
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      <strong>Example:</strong> user-auth, feature/dark-mode, dev-123
                      <br />
                      <strong>On submit:</strong> This branch will be created on all repositories listed below, branching from their specified source branches.
                      {validatingBranch && <span className="text-blue-600 ml-2 block mt-1">Validating availability...</span>}
                      {branchValidationError && <span className="text-red-600 ml-2 block mt-1">{branchValidationError}</span>}
                      {branchValidated && !validatingBranch && !branchValidationError && field.value && <span className="text-green-600 ml-2 block mt-1">✓ Available on all repositories</span>}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" />Source Repositories</CardTitle>
                <CardDescription>
                  Specify which repositories and branches to use as the base for your feature branch. 
                  The feature branch will be created from these source branches.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="text-sm font-medium">Spec Repository (Required)</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-3">
                      <FormField control={form.control} name="umbrellaRepo.url" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Repository URL</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="https://github.com/org/repo.git" 
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                setBranchValidated(false); // Mark as unvalidated when repo changes
                              }}
                              onBlur={() => {
                                field.onBlur();
                                triggerBranchValidation();
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="md:col-span-1">
                      <FormField control={form.control} name="umbrellaRepo.branch" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source Branch</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="main" 
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                setBranchValidated(false);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <strong>What this means:</strong> The feature branch will be created from this repository&apos;s source branch (e.g., branching from &apos;main&apos;)
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-sm font-medium">Supporting Repositories (optional)</div>
                  <div className="text-xs text-muted-foreground">Additional repositories that will also get the feature branch</div>
                  
                  {fields.map((field, index) => (
                    <div key={field.id} className="space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-3">
                          <FormField control={form.control} name={`supportingRepos.${index}.url`} render={({ field }) => (
                            <FormItem>
                              <FormLabel>Repository URL</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="https://github.com/org/repo.git" 
                                  {...field}
                                  onChange={(e) => {
                                    field.onChange(e);
                                    setBranchValidated(false); // Mark as unvalidated when repo changes
                                  }}
                                  onBlur={() => {
                                    field.onBlur();
                                    triggerBranchValidation();
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <div className="md:col-span-1">
                          <FormField control={form.control} name={`supportingRepos.${index}.branch`} render={({ field }) => (
                            <FormItem>
                              <FormLabel>Source Branch</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="main" 
                                  {...field}
                                  onChange={(e) => {
                                    field.onChange(e);
                                    setBranchValidated(false);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm" 
                          onClick={() => {
                            remove(index);
                            setBranchValidated(false); // Mark as unvalidated when repo removed
                            // Trigger validation after a short delay to allow form state to update
                            setTimeout(() => triggerBranchValidation(), 100);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  <div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => append({ url: "", branch: "main" })}>
                      Add supporting repo
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            {/* Agent selection omitted in this simplified flow */}

            {error && (
              <Card className="border-red-200 bg-red-50"><CardContent className="pt-6"><p className="text-red-600 text-sm">{error}</p></CardContent></Card>
            )}

            {form.getValues("featureBranch") && form.getValues("umbrellaRepo.url") && (
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="pt-6">
                  <div className="text-sm text-blue-900">
                    <div className="font-semibold mb-2">📋 What will happen when you submit:</div>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>A new branch <code className="bg-blue-100 px-1 py-0.5 rounded">{form.getValues("featureBranch") || "[branch-name]"}</code> will be created on all repositories</li>
                      <li>Each new branch will be created from its specified source branch (e.g., <code className="bg-blue-100 px-1 py-0.5 rounded">{form.getValues("umbrellaRepo.branch") || "main"}</code>)</li>
                      <li>The RFE workflow will be configured to use these repositories</li>
                      <li>You can then seed the repositories with spec-kit and agents</li>
                      <li>AI sessions will clone from source branches and push to the feature branch</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-4">
              <Link href={`/projects/${encodeURIComponent(project)}/rfe`}>
                <Button variant="outline" disabled={isSubmitting}>Cancel</Button>
              </Link>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating RFE Workspace...</>
                ) : (
                  "Create RFE Workspace"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
