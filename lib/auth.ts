import { NextRequest, NextResponse } from 'next/server';

export function getExpectedApiKey(): string {
  return process.env.API_KEY || 'koya-assessment-api-key-secret';
}

export function validateApiKey(req: NextRequest): { isValid: boolean; response?: NextResponse } {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = getExpectedApiKey();

  if (!apiKey || apiKey !== expectedKey) {
    return {
      isValid: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Missing or invalid X-API-Key header' },
        { status: 401 }
      ),
    };
  }

  return { isValid: true };
}
