import { useEffect, useState } from 'react';
import { getBackupStatus, type BackupStatus } from '../../db/backupRepo';
import { useDataVersion } from '../../hooks/useDataVersion';

/** Backup status of this journal (null until first read); refreshes whenever stored data changes. */
export function useBackupStatus(): BackupStatus | null {
  const version = useDataVersion();
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useEffect(() => {
    let alive = true;
    getBackupStatus().then(
      (next) => {
        if (alive) setStatus(next);
      },
      () => undefined, // the status is informational; the screen works without it
    );
    return () => {
      alive = false;
    };
  }, [version]);

  return status;
}
