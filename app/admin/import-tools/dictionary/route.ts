import { handleImport } from '@/lib/adminCatalogTools/importProxy';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleImport(request, 'dictionary');
export const POST = (request: Request) => handleImport(request, 'dictionary');
