import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Sports Dashboard</h1>
      <p className="text-muted-foreground">
        Follow your favorite teams and subscribe to their matches in your
        calendar.
      </p>
      <Button disabled>Coming soon</Button>
    </main>
  );
}
