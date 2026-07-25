import * as React from "react";
import { ConstructionIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ConstructionIcon className="size-5 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {description ?? "This section is part of the roadmap and will be implemented soon."}
      </CardContent>
    </Card>
  );
}
